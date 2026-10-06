import {
  ENGINE_VERSION,
  type AnalysisLimits,
  type AnalysisReport,
  type AnalysisStatus,
  type CompositionReport,
  type HazardMinimality,
  type ModelBundle,
  type PolicyId,
} from '../model/types';
import { analyzeCompiled } from './analyze';
import { sortedUnique } from './canonicalize';

export type Progress = (completed: number, total: number, label: string) => void;

function subsetsOf(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << ids.length; mask++) out.push(ids.filter((_, i) => mask & (1 << i)));
  return out.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

const isProperSubset = (p: string[], a: string[]) => p.length < a.length && p.every((x) => a.includes(x));

/** Analyzes all 2^n subsets of the candidate automations against the same cases and baseline controls. */
export function analyzeComposition(
  bundle: ModelBundle,
  candidateIds: readonly string[],
  caseIds: readonly string[],
  limits: AnalysisLimits,
  progress?: Progress,
): CompositionReport {
  const ids = sortedUnique(candidateIds);
  const subsets = subsetsOf(ids);
  const results: { set: string[]; report: AnalysisReport }[] = [];
  subsets.forEach((set, i) => {
    results.push({ set, report: analyzeCompiled(bundle, { automationIds: set, controlIds: [] }, caseIds, limits) });
    progress?.(i + 1, subsets.length, set.length ? set.join(' + ') : 'none');
  });

  const hazardIndex = new Map<string, { policyId: PolicyId; caseId: string; mechanism: string }>();
  for (const r of results) for (const f of r.report.findings) hazardIndex.set(f.id, { policyId: f.policyId, caseId: f.caseId, mechanism: f.mechanism });

  const hazards: HazardMinimality[] = [];
  for (const [hazardId, info] of [...hazardIndex.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const has = (r: { report: AnalysisReport }) => r.report.findings.some((f) => f.id === hazardId);
    const reachable = results.filter(has);
    const minimal: string[][] = [];
    const unknown: string[][] = [];
    for (const r of reachable) {
      const proper = results.filter((p) => isProperSubset(p.set, r.set));
      if (proper.some(has)) continue; // not minimal: a proper subset already reaches it
      const blockers = proper.filter((p) => p.report.analysisStatus !== 'complete');
      if (blockers.length > 0) unknown.push(...blockers.map((b) => b.set));
      else minimal.push(r.set);
    }
    const unknownSets = [...new Map(unknown.map((u) => [u.join(), u])).values()];
    hazards.push({
      hazardId,
      policyId: info.policyId,
      caseId: info.caseId,
      mechanism: info.mechanism,
      status: minimal.length > 0 ? 'established' : 'unknown',
      minimalSets: minimal,
      reachableIn: reachable.map((r) => r.set),
      unknownSubsets: unknownSets,
      note:
        minimal.length > 0
          ? `Reachable under ${reachable.length} subset(s); every proper subset of each minimal set was checked complete and free of this hazard.`
          : 'Minimality not established: a proper subset is incomplete or unknown, so no minimal set is claimed.',
    });
  }

  const status: AnalysisStatus = results.some((r) => r.report.analysisStatus === 'invalid')
    ? 'invalid'
    : results.every((r) => r.report.analysisStatus === 'complete')
      ? 'complete'
      : 'partial';
  return {
    engineVersion: ENGINE_VERSION,
    caseIds: [...caseIds],
    subsets: results.map((r) => ({
      automationIds: r.set,
      analysisStatus: r.report.analysisStatus,
      policyStatus: r.report.policyStatus,
      goalStatus: r.report.goalStatus,
      hazardIds: r.report.findings.map((f) => f.id),
      report: r.report,
    })),
    hazards,
    analysisStatus: status,
    incompleteReasons: sortedUnique(results.flatMap((r) => [...r.report.invalidReasons, ...r.report.incompleteReasons])),
  };
}
