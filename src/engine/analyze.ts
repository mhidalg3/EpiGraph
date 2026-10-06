import { semanticIssues } from '../model/validate';
import {
  ENGINE_VERSION,
  POLICY_IDS,
  type AnalysisLimits,
  type AnalysisReport,
  type AnalysisStatus,
  type CaseReport,
  type Design,
  type Finding,
  type GoalFailure,
  type GoalStatus,
  type ModelBundle,
  type PolicyResult,
  type PolicyStatus,
  type SemanticAtom,
} from '../model/types';
import { capabilityExcess } from './capabilities';
import { canonicalJson, shortHash, sortedUnique } from './canonicalize';
import { compileDesign, type CompiledModel } from './compile';
import { exploreCase, type ExploreOptions } from './explore';

export const ASSUMPTION_STATEMENTS: readonly string[] = [
  'Finite model: one supplier and one invoice per case, at most two bank versions, one supplier update, one retry and one re-preparation/reauthorization.',
  'The engine and compiler are not formally verified; counterexample replay, mutation tests and independently specified expected cases are the checks.',
  'No multi-supplier shared-mutable-state assurance: one supplier per case is an explicit assurance boundary.',
  'Extraction output domains are declared per case; incorrect extraction is modeled only in the declared extraction-mismatch exception case, not for all plausible extractor outputs.',
  'Capability inventory is declared complete: an absent exact grant means the modeled API cannot perform the operation.',
  'Fixtures are stipulated fictional truth (evidence status fixture), not independently verified real-world evidence; hashes establish reproducibility, not certification.',
];

const validated = new WeakMap<ModelBundle, string[]>();
export function issuesOf(bundle: ModelBundle): string[] {
  let r = validated.get(bundle);
  if (!r) {
    r = semanticIssues(bundle);
    validated.set(bundle, r);
  }
  return r;
}

export interface AnalyzeOptions extends ExploreOptions {
  /** Cases whose requiresAutomations are not satisfied by the design are skipped (and reported) instead of analyzed. */
  noCache?: boolean;
}

function emptyReport(bundle: ModelBundle, design: Design, caseIds: readonly string[], limits: AnalysisLimits): AnalysisReport {
  return {
    engineVersion: ENGINE_VERSION,
    schemaVersion: bundle.schemaVersion,
    graphVersion: bundle.graphVersion,
    policyVersion: bundle.policyVersion,
    analysisDate: bundle.analysisDate,
    analysisStatus: 'invalid',
    policyStatus: 'unknown',
    goalStatus: 'unknown',
    design: { automationIds: sortedUnique(design.automationIds), controlIds: sortedUnique(design.controlIds) },
    effective: {
      requestedAutomationIds: sortedUnique(design.automationIds),
      effectiveAutomationIds: [],
      requestedControlIds: sortedUnique(design.controlIds),
      appliedControlIds: [],
      noopControlIds: [],
      inapplicableControlIds: [],
      variantIds: [...bundle.appliedVariantIds],
      provenance: [],
    },
    caseIds: [...caseIds],
    cases: [],
    policies: [],
    findings: [],
    goalFailures: [],
    atoms: [],
    capabilityNotices: [],
    assumptions: [...ASSUMPTION_STATEMENTS],
    incompleteReasons: [],
    invalidReasons: [],
    limits,
    totals: { states: 0, transitions: 0 },
    semanticKey: '',
  };
}

function invalid(bundle: ModelBundle, design: Design, caseIds: readonly string[], limits: AnalysisLimits, reasons: string[]): AnalysisReport {
  const r = emptyReport(bundle, design, caseIds, limits);
  r.invalidReasons = reasons;
  r.policies = POLICY_IDS.map((p) => ({ policyId: p, name: bundle.policies.find((x) => x.id === p)?.name ?? p, status: 'unknown', findingIds: [], reason: 'analysis invalid' }));
  return r;
}

function unknownCritical(model: CompiledModel): string[] {
  const out: string[] = [];
  const b = model.bundle;
  if (b.completeness.capabilityInventory === 'unknown') out.push('Capability inventory is not declared complete: technical abilities are unknown, so no grant is assumed or denied.');
  if (b.completeness.controlImplementation === 'unknown') out.push('Control implementation completeness is unknown.');
  if (b.completeness.evidenceInventory === 'unknown') out.push('Evidence inventory is not declared complete: negation over missing evidence is not meaningful.');
  for (const c of model.contracts)
    for (const id of c.implementedControlIds) {
      const ctl = model.controls.get(id);
      if (ctl && ctl.implemented === 'unknown') out.push(`Control ${id} (attached to ${c.id}) has unknown implementation status.`);
    }
  return sortedUnique(out);
}

function safeguardNotes(model: CompiledModel, finding: { policyId: string }): { enabling: string[]; retained: string[] } {
  const enabling = model.effective.provenance
    .filter((p) => p.changed && p.stage !== 'control' && /removeContract|removeControl|setPrecondition|removeCapability|setActor/.test(p.summary))
    .map((p) => p.source);
  const retained: string[] = [];
  if (finding.policyId === 'P01') {
    const has = (id: string) => model.contractById.has(id);
    retained.push(has('W10') ? 'W10 independent payment approval is retained, but it approves the amount and exact payload, not the authenticity of the bank details.' : 'W10 is absent.');
    if (!has('W03')) retained.push('W03 precommit beneficiary verification is absent.');
    if (!has('W09')) retained.push('W09 release-time beneficiary check is absent.');
    const gate = ['W11', 'W14'].some((id) => model.contractById.get(id)?.implementedControlIds.includes('C2'));
    if (!gate) retained.push('No gateway control enforces beneficiary evidence at W11/W14.');
  }
  return { enabling: sortedUnique(enabling), retained };
}

const cache = new Map<string, AnalysisReport>();
export function clearAnalysisCache(): void {
  cache.clear();
}

/** Internal entry used by composition/synthesis; analyze() is the public wrapper. */
export function analyzeCompiled(
  bundle: ModelBundle,
  design: Design,
  caseIds: readonly string[],
  limits: AnalysisLimits,
  opts: AnalyzeOptions = {},
): AnalysisReport {
  const issues = issuesOf(bundle);
  if (issues.length > 0) return invalid(bundle, design, caseIds, limits, issues);
  if (caseIds.length === 0) return invalid(bundle, design, caseIds, limits, ['No cases selected: an empty selection is invalid, not a vacuous pass.']);
  const unknownCases = caseIds.filter((id) => !bundle.cases.some((c) => c.id === id));
  if (unknownCases.length > 0) return invalid(bundle, design, caseIds, limits, [`Unknown case ids: ${unknownCases.join(', ')}`]);

  const compiled = compileDesign(bundle, design);
  if (!compiled.ok) return invalid(bundle, design, caseIds, limits, compiled.reasons);
  const model = compiled.model;

  const cacheKey = canonicalJson([model.semanticKey, model.effective.provenance.map((p) => p.source + p.changed), caseIds, limits, !!opts.shortCircuit, design]);
  if (!opts.noCache) {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  }

  const report = emptyReport(bundle, design, caseIds, limits);
  report.effective = model.effective;
  report.semanticKey = shortHash(model.semanticKey);
  report.capabilityNotices = capabilityExcess(model);

  const unknowns = unknownCritical(model);
  if (unknowns.length > 0) {
    report.analysisStatus = 'partial';
    report.incompleteReasons = unknowns;
    report.policies = POLICY_IDS.map((p) => ({ policyId: p, name: bundle.policies.find((x) => x.id === p)?.name ?? p, status: 'unknown', findingIds: [], reason: 'critical capability/control metadata unknown; no exploration performed' }));
    report.cases = caseIds.map((id) => ({ caseId: id, label: bundle.cases.find((c) => c.id === id)!.label, status: 'partial', statesExplored: 0, transitionsExplored: 0, terminalDispositions: {}, deadlocks: 0, reasons: ['not explored'] }));
    return report;
  }

  const designAutomations = new Set(report.design.automationIds);
  const atoms = new Map<string, SemanticAtom>();
  const findings: Finding[] = [];
  const goalFailures: GoalFailure[] = [];
  const cases: CaseReport[] = [];
  let anyPartial = false;
  let analyzed = 0;
  for (const id of caseIds) {
    const c = bundle.cases.find((x) => x.id === id)!;
    if (!c.requiresAutomations.every((a) => designAutomations.has(a))) {
      cases.push({ caseId: id, label: c.label, status: 'skipped', statesExplored: 0, transitionsExplored: 0, terminalDispositions: {}, deadlocks: 0, reasons: [`not applicable: requires automation ${c.requiresAutomations.join(', ')}`] });
      continue;
    }
    analyzed++;
    const ex = exploreCase(model, c, limits, opts);
    cases.push(ex.report);
    if (!ex.complete) anyPartial = true;
    for (const f of ex.findings) {
      const notes = safeguardNotes(model, f);
      findings.push({ id: f.hazardId, policyId: f.policyId, caseId: f.caseId, mechanism: f.mechanism, message: f.violation.message, witness: f.witness, enablingPatches: notes.enabling, retainedSafeguards: notes.retained });
    }
    goalFailures.push(...ex.goalFailures);
    for (const [k, a] of ex.atoms) atoms.set(k, a);
    report.totals.states += ex.report.statesExplored;
    report.totals.transitions += ex.report.transitionsExplored;
    if (!ex.complete) report.incompleteReasons.push(...ex.report.reasons.map((r) => `${id}: ${r}`));
  }
  if (analyzed === 0) {
    report.invalidReasons = ['No selected case is applicable to this design.'];
    report.cases = cases;
    return report;
  }

  const status: AnalysisStatus = anyPartial ? 'partial' : 'complete';
  const policies: PolicyResult[] = POLICY_IDS.map((p) => {
    const ids = findings.filter((f) => f.policyId === p).map((f) => f.id).sort();
    const st: PolicyStatus = ids.length > 0 ? 'violated' : status === 'complete' ? 'satisfied_in_model' : 'unknown';
    return {
      policyId: p,
      name: bundle.policies.find((x) => x.id === p)?.name ?? p,
      status: st,
      findingIds: ids,
      reason: st === 'violated' ? `${ids.length} reachable violating hazard(s)` : st === 'satisfied_in_model' ? 'exploration exhausted with no violation in the finite model' : 'exploration incomplete: absence of a witness is unknown, not a pass',
    };
  });
  report.cases = cases;
  report.analysisStatus = status;
  report.policies = policies;
  report.findings = findings.sort((a, b) => (a.id < b.id ? -1 : 1));
  report.goalFailures = goalFailures.sort((a, b) => (a.id < b.id ? -1 : 1));
  report.policyStatus = policies.some((p) => p.status === 'violated') ? 'violated' : policies.some((p) => p.status === 'unknown') ? 'unknown' : 'satisfied_in_model';
  const goal: GoalStatus = goalFailures.length > 0 ? 'failed' : status === 'complete' ? 'satisfied' : 'unknown';
  report.goalStatus = goal;
  report.atoms = [...atoms.values()].sort((a, b) => (a.signature < b.signature ? -1 : 1));
  report.incompleteReasons = sortedUnique(report.incompleteReasons);
  if (!opts.noCache) cache.set(cacheKey, report);
  return report;
}
