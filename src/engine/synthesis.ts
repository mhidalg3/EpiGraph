import {
  ENGINE_VERSION,
  type AnalysisLimits,
  type AnalysisReport,
  type AnalysisStatus,
  type Design,
  type ModelBundle,
  type OptimizationStatus,
  type SearchCoverage,
  type SynthesisCandidate,
  type SynthesisReport,
} from '../model/types';
import { analyzeCompiled } from './analyze';
import { canonicalJson, shortHash, sortedUnique } from './canonicalize';
import { compileDesign, type CompiledModel } from './compile';
import type { Progress } from './composition';
import { compileManual, economicAssumptionLines, economicsOf, profileOf, type MinutesProfile } from './value';

function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << xs.length; mask++) out.push(xs.filter((_, i) => mask & (1 << i)));
  return out;
}

const cents = (n: number) => Math.round(n * 100);

interface Raw {
  design: Design;
  model: CompiledModel | null;
  conflictReasons: string[];
}

const synthesisCache = new Map<string, SynthesisReport>();

/**
 * Exhaustive finite search: every candidate is compiled from the original bundle (never cumulatively), rechecked against
 * all active cases, and accepted only on a complete safety + goal pass within review capacity.
 */
export function synthesize(
  bundle: ModelBundle,
  requestedDesign: Design,
  objective: 'least_disruption' | 'maximum_value',
  limits: AnalysisLimits,
  progress?: Progress,
): SynthesisReport {
  const requested: Design = { automationIds: sortedUnique(requestedDesign.automationIds), controlIds: sortedUnique(requestedDesign.controlIds) };
  const activeIds = bundle.cases.filter((c) => !c.economicOnly).map((c) => c.id);
  // the key covers every semantic input: full patch records, cases, economics, limits (never only ids)
  const key = shortHash(canonicalJson([objective, requested, activeIds, limits, bundle.economics, bundle.appliedVariantIds, bundle.repairs, bundle.automations]));
  const baseSemantic = compileDesign(bundle, requested);
  const cacheKey = baseSemantic.ok ? `${key}|${shortHash(baseSemantic.model.semanticKey)}` : key;
  const hit = synthesisCache.get(cacheKey);
  if (hit) return hit;

  const incomplete: string[] = [];
  const repairIds = bundle.repairs.map((r) => r.id).sort();
  const automationIds = bundle.automations.map((a) => a.id).sort();
  const designs: Design[] =
    objective === 'least_disruption'
      ? subsets(repairIds).map((c) => ({ automationIds: requested.automationIds, controlIds: sortedUnique([...requested.controlIds, ...c]) }))
      : subsets(automationIds).flatMap((a) => subsets(repairIds).map((c) => ({ automationIds: a, controlIds: c })));
  const rawCombinations = designs.length;
  const truncated = designs.length > limits.maxDesigns;
  const enumerated = truncated ? designs.slice(0, limits.maxDesigns) : designs;
  if (truncated) incomplete.push(`maxDesigns (${limits.maxDesigns}) reached: ${rawCombinations - enumerated.length} raw combinations were not enumerated, so optimality cannot be claimed`);

  // capacity and disruption are measured against the requested design WITHOUT repairs, never against already-applied controls
  const requestedCompiled = compileDesign(bundle, { automationIds: requested.automationIds, controlIds: [] });
  const manual = compileManual(bundle);
  if (!baseSemantic.ok || !requestedCompiled.ok || !manual) {
    const reasons = !baseSemantic.ok ? baseSemantic.reasons : !requestedCompiled.ok ? requestedCompiled.reasons : ['Manual baseline could not be compiled'];
    return emptySynthesis(objective, requested, 'invalid', reasons, key, bundle);
  }
  const manualProfile = profileOf(bundle, manual);
  // Review capacity and disruption are measured against the unrepaired design of the SAME automation set: in joint selection the
  // automation set is itself a decision, so dropping an automation is a different design, not extra repair work.
  const references = new Map<string, { model: CompiledModel; profile: MinutesProfile } | null>();
  const referenceFor = (automationIds: string[]) => {
    const k = automationIds.join('+');
    if (!references.has(k)) {
      const c = k === requested.automationIds.join('+') ? requestedCompiled : compileDesign(bundle, { automationIds, controlIds: [] });
      references.set(k, c.ok ? { model: c.model, profile: profileOf(bundle, c.model) } : null);
    }
    return references.get(k)!;
  };

  // compile every raw combination from the original bundle
  const raws: Raw[] = enumerated.map((d) => {
    const c = compileDesign(bundle, d);
    return c.ok ? { design: d, model: c.model, conflictReasons: [] } : { design: d, model: null, conflictReasons: c.reasons };
  });

  // deduplicate identical effective designs (same semantic key and same applied-control accounting)
  const unique = new Map<string, { raw: Raw; from: string[] }>();
  let deduplicated = 0;
  let conflicting = 0;
  let noop = 0;
  let inapplicable = 0;
  const conflictCandidates: SynthesisCandidate[] = [];
  for (const r of raws) {
    if (!r.model) {
      conflicting++;
      conflictCandidates.push(candidateShell(r.design, null, 'conflicting', ['conflicting patches: ' + r.conflictReasons.join('; ')]));
      continue;
    }
    const acct = canonicalJson([r.model.semanticKey, r.model.effective.appliedControlIds, r.model.effective.effectiveAutomationIds, r.design.automationIds.length > 0]);
    const k = shortHash(acct);
    const prior = unique.get(k);
    if (prior) {
      deduplicated++;
      prior.from.push(designKey(r.design));
    } else unique.set(k, { raw: r, from: [] });
    const requestedNew = r.model.effective.requestedControlIds.filter((id) => !requested.controlIds.includes(id));
    if (requestedNew.length > 0 && requestedNew.every((id) => r.model!.effective.inapplicableControlIds.includes(id))) inapplicable++;
    else if (requestedNew.length > 0 && requestedNew.every((id) => r.model!.effective.noopControlIds.includes(id) || r.model!.effective.inapplicableControlIds.includes(id))) noop++;
  }

  const candidates: SynthesisCandidate[] = [...conflictCandidates];
  let rechecked = 0;
  let i = 0;
  const entries = [...unique.values()];
  for (const { raw, from } of entries) {
    const model = raw.model!;
    const report: AnalysisReport = analyzeCompiled(bundle, raw.design, activeIds, limits, { shortCircuit: true });
    rechecked++;
    const ref = referenceFor(raw.design.automationIds);
    const econ = ref ? economicsOf(bundle, raw.design, model, ref.model, manualProfile, ref.profile) : null;
    candidates.push(evaluate(bundle, raw.design, model, report, econ, from));
    progress?.(++i, entries.length, designKey(raw.design));
  }

  const rank = (a: SynthesisCandidate, b: SynthesisCandidate): number => {
    const ea = a.economics;
    const eb = b.economics;
    if (!ea || !eb) return ea ? -1 : eb ? 1 : a.key < b.key ? -1 : 1;
    if (objective === 'least_disruption') {
      return cents(ea.disruptionUsd) - cents(eb.disruptionUsd) || ea.changedElements - eb.changedElements || (a.key < b.key ? -1 : 1);
    }
    return cents(eb.netValueUsd) - cents(ea.netValueUsd) || ea.changedElements - eb.changedElements || (a.key < b.key ? -1 : 1);
  };
  candidates.sort((a, b) => (a.verdict === 'accepted' ? 0 : 1) - (b.verdict === 'accepted' ? 0 : 1) || rank(a, b));
  const accepted = candidates.filter((c) => c.verdict === 'accepted');
  const unknown = candidates.filter((c) => c.verdict === 'unknown');
  const best = accepted[0] ?? null;
  const unrepaired = candidates.find((c) => c.key === designKey(requested) || c.deduplicatedFrom.includes(designKey(requested))) ?? null;

  let status: OptimizationStatus;
  const analysisStatus: AnalysisStatus = unknown.length > 0 || truncated ? 'partial' : 'complete';
  if (unknown.length > 0) incomplete.push(`${unknown.length} candidate(s) could not be fully verified (partial or invalid analysis)`);
  if (best) {
    const blocking = unknown.some((u) => !u.economics || rank(u, best) <= 0);
    status = !blocking && !truncated ? 'optimal_in_catalog' : 'best_verified_found';
  } else status = unknown.length > 0 || truncated || candidates.length === 0 ? 'unknown' : 'no_feasible_design';

  const coverage: SearchCoverage = {
    rawCombinations,
    applicable: candidates.filter((c) => c.applicability === 'applicable').length,
    noop,
    inapplicable,
    conflicting,
    deduplicated,
    rechecked,
    rejected: candidates.filter((c) => c.verdict === 'rejected').length,
    accepted: accepted.length,
    unknown: unknown.length,
    truncatedByMaxDesigns: truncated,
  };
  const report: SynthesisReport = {
    engineVersion: ENGINE_VERSION,
    objective,
    requested,
    optimizationStatus: status,
    analysisStatus,
    candidates,
    unrepaired,
    best,
    coverage,
    incompleteReasons: incomplete,
    assumptionsUsed: economicAssumptionLines(bundle),
    semanticKey: key,
  };
  synthesisCache.set(cacheKey, report);
  return report;
}

export function clearSynthesisCache(): void {
  synthesisCache.clear();
}

const designKey = (d: Design) => `${d.automationIds.join('+') || 'none'}|${d.controlIds.join('+') || 'none'}`;

function candidateShell(design: Design, model: CompiledModel | null, applicability: SynthesisCandidate['applicability'], reasons: string[]): SynthesisCandidate {
  return {
    key: designKey(design),
    controlIds: design.controlIds,
    automationIds: design.automationIds,
    effectiveAutomationIds: model?.effective.effectiveAutomationIds ?? [],
    appliedControlIds: model?.effective.appliedControlIds ?? [],
    noopControlIds: model?.effective.noopControlIds ?? [],
    applicability,
    verdict: 'rejected',
    rejectionReasons: reasons,
    policyStatus: 'unknown',
    goalStatus: 'unknown',
    analysisStatus: 'invalid',
    capacityOk: false,
    economics: null,
    hazardIds: [],
    deduplicatedFrom: [],
  };
}

function evaluate(
  bundle: ModelBundle,
  design: Design,
  model: CompiledModel,
  report: AnalysisReport,
  econ: SynthesisCandidate['economics'],
  from: string[],
): SynthesisCandidate {
  const reasons: string[] = [];
  let verdict: SynthesisCandidate['verdict'] = 'accepted';
  if (report.analysisStatus === 'invalid') {
    verdict = 'unknown';
    reasons.push(...report.invalidReasons);
  }
  if (report.policyStatus === 'violated') {
    verdict = 'rejected';
    reasons.push(...report.findings.map((f) => `${f.policyId} reachable: ${f.id}`));
  }
  if (report.goalStatus === 'failed') {
    verdict = 'rejected';
    reasons.push(...report.goalFailures.map((g) => `business goal failed: ${g.message} (${g.caseId})`));
  }
  if (verdict === 'accepted' && (report.analysisStatus !== 'complete' || report.policyStatus !== 'satisfied_in_model' || report.goalStatus !== 'satisfied')) {
    verdict = 'unknown';
    reasons.push('analysis incomplete: absence of a violation is unknown, not a pass');
  }
  let capacityOk = true;
  if (!econ) {
    if (verdict === 'accepted') {
      verdict = 'rejected';
      reasons.push('nominal economic route unavailable for this design');
    }
    capacityOk = false;
  } else if (econ.addedReviewHours > bundle.economics.reviewCapacityHours + 1e-9) {
    capacityOk = false;
    if (verdict !== 'unknown') verdict = 'rejected';
    reasons.push(`review capacity exceeded: ${econ.addedReviewHours.toFixed(2)} h > ${bundle.economics.reviewCapacityHours} h budget`);
  }
  const eff = model.effective;
  const added = eff.requestedControlIds;
  const applicability: SynthesisCandidate['applicability'] =
    added.length > 0 && added.every((id) => eff.inapplicableControlIds.includes(id))
      ? 'inapplicable'
      : added.length > 0 && eff.appliedControlIds.length === 0
        ? 'noop'
        : 'applicable';
  return {
    key: designKey(design),
    controlIds: design.controlIds,
    automationIds: design.automationIds,
    effectiveAutomationIds: eff.effectiveAutomationIds,
    appliedControlIds: eff.appliedControlIds,
    noopControlIds: eff.noopControlIds,
    applicability,
    verdict,
    rejectionReasons: sortedUnique(reasons),
    policyStatus: report.policyStatus,
    goalStatus: report.goalStatus,
    analysisStatus: report.analysisStatus,
    capacityOk,
    economics: econ,
    hazardIds: report.findings.map((f) => f.id),
    deduplicatedFrom: from,
  };
}

function emptySynthesis(objective: SynthesisReport['objective'], requested: Design, status: AnalysisStatus, reasons: string[], key: string, bundle: ModelBundle): SynthesisReport {
  return {
    engineVersion: ENGINE_VERSION,
    objective,
    requested,
    optimizationStatus: 'unknown',
    analysisStatus: status,
    candidates: [],
    unrepaired: null,
    best: null,
    coverage: { rawCombinations: 0, applicable: 0, noop: 0, inapplicable: 0, conflicting: 0, deduplicated: 0, rechecked: 0, rejected: 0, accepted: 0, unknown: 0, truncatedByMaxDesigns: false },
    incompleteReasons: reasons,
    assumptionsUsed: economicAssumptionLines(bundle),
    semanticKey: key,
  };
}

