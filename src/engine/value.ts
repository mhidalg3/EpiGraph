import type { CaseRecord, ClassEconomics, DesignEconomics, Design, ModelBundle } from '../model/types';
import { canonicalJson } from './canonicalize';
import { compileDesign, type CompiledModel } from './compile';
import { applyTransition, enabledTransitions, initialState, isTerminal } from './transitions';

export interface RouteResult {
  ok: boolean;
  steps: string[];
  humanMinutes: number;
  verificationMinutes: number;
  reason: string;
}

/**
 * Executes one declared nominal valid route: deterministic choice of the first enabled transition on a nominal branch,
 * restricted to the class's route activities. Minutes are charged only for human-actor steps. This is not a frequency model.
 */
export function nominalRoute(model: CompiledModel, c: CaseRecord, routeActivities: readonly string[]): RouteResult {
  let state = initialState(model, c);
  const steps: string[] = [];
  let minutes = 0;
  let verification = 0;
  for (let i = 0; i < 200; i++) {
    const next = enabledTransitions(model, c, state).find(
      (t) => routeActivities.includes(t.activityId) && (t.kind === 'blocked' || t.branch!.nominal),
    );
    if (!next) break;
    if (next.kind === 'branch' && model.principals.get(next.actorId)?.principalKind === 'human') {
      minutes += next.branch!.minutes;
      if (next.branch!.verification) verification += next.branch!.minutes;
    }
    steps.push(next.id);
    state = applyTransition(model, c, state, next).state;
    if (isTerminal(state)) break;
  }
  const req = c.requiredOutcome;
  const committed =
    typeof state.facts['master.current'] === 'number' && (state.facts['master.current'] as number) >= 0 && state.evidence.some((e) => e.kind === 'onboardingClearance');
  const ok =
    req.kind === 'reconciled' ? state.facts.disposition === 'reconciled' : req.kind === 'supplier_committed' ? committed : state.facts.disposition === 'held';
  return { ok, steps, humanMinutes: minutes, verificationMinutes: verification, reason: ok ? '' : `nominal route for ${c.id} did not reach its required outcome` };
}

export interface MinutesProfile {
  perClass: { classId: string; minutes: number; verificationMinutes: number; route: string[]; ok: boolean; reason: string }[];
}

export function profileOf(bundle: ModelBundle, model: CompiledModel): MinutesProfile {
  return {
    perClass: bundle.economics.classes.map((k) => {
      const c = bundle.cases.find((x) => x.id === k.caseId)!;
      const r = nominalRoute(model, c, k.routeActivities);
      return { classId: k.id, minutes: r.humanMinutes, verificationMinutes: r.verificationMinutes, route: r.steps, ok: r.ok, reason: r.reason };
    }),
  };
}

export function monthlyCounts(bundle: ModelBundle): Record<string, number> {
  const m = bundle.economics.monthly;
  return {
    routineInvoice: m.invoices - m.paidSupplierEvents,
    supplierEventPaid: m.paidSupplierEvents,
    supplierEventUnpaid: m.supplierEvents - m.paidSupplierEvents,
  };
}

/** Number of workflow/capability elements that differ between two effective models (contracts, grants, rules, systems, principals). */
export function changedElements(a: CompiledModel, b: CompiledModel): number {
  const diff = <T>(xs: T[], ys: T[], key: (x: T) => string, val: (x: T) => string) => {
    const mx = new Map(xs.map((x) => [key(x), val(x)]));
    const my = new Map(ys.map((y) => [key(y), val(y)]));
    let n = 0;
    for (const [k, v] of mx) if (my.get(k) !== v) n++;
    for (const k of my.keys()) if (!mx.has(k)) n++;
    return n;
  };
  const x = a.bundle;
  const y = b.bundle;
  return (
    diff(x.contracts, y.contracts, (c) => c.id, (c) => canonicalJson(c)) +
    diff(x.capabilities, y.capabilities, (g) => g.id, (g) => canonicalJson(g)) +
    diff(x.authorization, y.authorization, (r) => r.id, (r) => canonicalJson(r)) +
    diff(x.entities.filter((e) => e.kind === 'System' || e.kind === 'Principal'), y.entities.filter((e) => e.kind === 'System' || e.kind === 'Principal'), (e) => e.id, (e) => canonicalJson(e))
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Capacity-equivalent economics of an effective design against the requested unrepaired design and the manual baseline. */
export function economicsOf(
  bundle: ModelBundle,
  requested: Design,
  model: CompiledModel,
  requestedModel: CompiledModel,
  manualProfile: MinutesProfile,
  requestedProfile: MinutesProfile,
): DesignEconomics | null {
  const profile = profileOf(bundle, model);
  const e = bundle.economics;
  const counts = monthlyCounts(bundle);
  const classes: ClassEconomics[] = e.classes.map((k, i) => ({
    classId: k.id,
    label: k.label,
    monthlyCount: counts[k.id]!,
    minutesPerEvent: profile.perClass[i]!.minutes,
    verificationMinutesPerEvent: profile.perClass[i]!.verificationMinutes,
    route: profile.perClass[i]!.route,
    routeStatus: profile.perClass[i]!.ok ? 'ok' : 'unavailable',
  }));
  if (classes.some((c) => c.routeStatus === 'unavailable')) return null;

  const r = e.humanHourValueUsd / 60;
  let savedMinutes = 0;
  let extraMinutes = 0;
  classes.forEach((c, i) => {
    savedMinutes += c.monthlyCount * (manualProfile.perClass[i]!.minutes - c.minutesPerEvent);
    extraMinutes += c.monthlyCount * (c.minutesPerEvent - requestedProfile.perClass[i]!.minutes);
  });
  const anyAutomation = requested.automationIds.length > 0;
  const platformRecurring = anyAutomation ? e.platform.recurringUsd : 0;
  const platformSetup = anyAutomation ? e.platform.setupUsd / e.amortizationMonths : 0;
  let controlRecurring = 0;
  let controlSetup = 0;
  for (const id of model.effective.appliedControlIds) {
    const cc = e.controlCosts[id];
    if (cc) {
      controlRecurring += cc.recurringUsd;
      controlSetup += cc.setupUsd / e.amortizationMonths;
    }
  }
  const addedReviewHours = Math.max(0, extraMinutes) / 60;
  const lostBenefit = Math.max(0, extraMinutes) * r;
  const gross = savedMinutes * r;
  return {
    classes,
    grossBenefitUsd: round2(gross),
    recurringPlatformUsd: round2(platformRecurring),
    recurringControlUsd: round2(controlRecurring),
    setupMonthlyUsd: round2(platformSetup + controlSetup),
    netValueUsd: round2(gross - platformRecurring - controlRecurring - platformSetup - controlSetup),
    addedReviewHours: round2(addedReviewHours),
    lostBenefitUsd: round2(lostBenefit),
    addedRecurringUsd: round2(controlRecurring),
    addedSetupMonthlyUsd: round2(controlSetup),
    disruptionUsd: round2(lostBenefit + controlRecurring + controlSetup),
    changedElements: changedElements(requestedModel, model),
    assumptionsUsed: economicAssumptionLines(bundle),
  };
}

export function economicAssumptionLines(bundle: ModelBundle): string[] {
  const e = bundle.economics;
  const c = monthlyCounts(bundle);
  return [
    `Monthly volumes: ${e.monthly.invoices} invoices, ${e.monthly.supplierEvents} supplier events, ${e.monthly.paidSupplierEvents} leading to payment → classes: ${c.routineInvoice} routine invoices, ${c.supplierEventPaid} paid supplier events, ${c.supplierEventUnpaid} supplier-only events`,
    `Human hour value USD ${e.humanHourValueUsd}; review-capacity budget ${e.reviewCapacityHours} extra hours/month`,
    `Platform cost (platform-wide, charged whenever any automation is requested): USD ${e.platform.recurringUsd}/month recurring + USD ${e.platform.setupUsd} setup amortized over ${e.amortizationMonths} months`,
    `Incremental control costs USD/month recurring (+ setup): ${Object.entries(e.controlCosts).map(([k, v]) => `${k} ${v.recurringUsd}${v.setupUsd ? `+${v.setupUsd}` : ''}`).join(', ')}`,
    'Human minutes are stipulated per activity branch and charged only for human actors on one nominal valid route per class (not measured, not a frequency model).',
    'Capacity-equivalent value is not guaranteed cash savings.',
  ];
}

export function compileManual(bundle: ModelBundle): CompiledModel | null {
  const r = compileDesign(bundle, { automationIds: [], controlIds: [] });
  return r.ok ? r.model : null;
}
