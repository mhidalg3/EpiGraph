import type {
  AnalysisLimits,
  AnalysisReport,
  CompositionReport,
  Design,
  DiffReport,
  ModelBundle,
  SynthesisReport,
  Witness,
  WitnessReplayResult,
} from '../model/types';
import { analyzeCompiled } from './analyze';
import { analyzeComposition as composition, type Progress } from './composition';
import { compileDesign } from './compile';
import { diffReports } from './differential';
import { synthesize as synth } from './synthesis';
import { replayOnModel } from './witness';

export { applyVariants } from './compile';
export { clearAnalysisCache } from './analyze';
export { clearSynthesisCache } from './synthesis';
export type { Progress } from './composition';

export function analyze(bundle: ModelBundle, design: Design, caseIds: readonly string[], limits: AnalysisLimits): AnalysisReport {
  return analyzeCompiled(bundle, design, caseIds, limits);
}

export function compare(bundle: ModelBundle, baseline: Design, candidate: Design, caseIds: readonly string[], limits: AnalysisLimits): DiffReport {
  return diffReports(analyzeCompiled(bundle, baseline, caseIds, limits), analyzeCompiled(bundle, candidate, caseIds, limits));
}

export function analyzeComposition(bundle: ModelBundle, candidateIds: readonly string[], caseIds: readonly string[], limits: AnalysisLimits, progress?: Progress): CompositionReport {
  return composition(bundle, candidateIds, caseIds, limits, progress);
}

export function synthesize(bundle: ModelBundle, requestedDesign: Design, objective: 'least_disruption' | 'maximum_value', limits: AnalysisLimits, progress?: Progress): SynthesisReport {
  return synth(bundle, requestedDesign, objective, limits, progress);
}

export function replayWitness(bundle: ModelBundle, design: Design, witness: Witness): WitnessReplayResult {
  const c = compileDesign(bundle, design);
  if (!c.ok) return { status: 'rejected', reasons: c.reasons, verifiedSteps: 0, failingStepIndex: null, violation: null };
  return replayOnModel(c.model, witness);
}

/**
 * Restrict a validated bundle to the selected assurance cases. Unselected cases that the economic routes reference are
 * kept as economicOnly so synthesis still has its nominal routes; all other unselected cases are removed.
 * Empty or unknown selections are returned as-is so the engine reports them as invalid, never as a vacuous pass.
 */
export function selectCases(bundle: ModelBundle, caseIds: readonly string[]): ModelBundle {
  const selected = new Set(caseIds);
  const econ = new Set(bundle.economics.classes.map((k) => k.caseId));
  const b = structuredClone(bundle);
  b.cases = b.cases
    .filter((c) => selected.has(c.id) || econ.has(c.id))
    .map((c) => (selected.has(c.id) ? c : { ...c, economicOnly: true }));
  const kept = new Set(b.cases.map((c) => c.id));
  b.suites = b.suites.map((su) => ({ ...su, caseIds: su.caseIds.filter((id) => kept.has(id)) })).filter((su) => su.caseIds.length > 0);
  const suiteIds = new Set(b.suites.map((su) => su.id));
  for (const c of b.cases) c.suiteIds = c.suiteIds.filter((id) => suiteIds.has(id));
  return b;
}
