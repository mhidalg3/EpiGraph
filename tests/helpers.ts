import { analyze, applyVariants, selectCases } from '../src/engine';
import { loadBundledBundle } from '../src/fixtures';
import { DEFAULT_LIMITS } from '../src/model/schemas';
import type { AnalysisLimits, AnalysisReport, ModelBundle } from '../src/model/types';

export interface RunOptions {
  automations?: string[];
  controls?: string[];
  variants?: string[];
  suite?: string;
  cases?: string[];
  limits?: AnalysisLimits;
  mutate?: (b: ModelBundle) => void;
}

export function freshBundle(): ModelBundle {
  return loadBundledBundle();
}

/** Bundle with named variants applied (and optional ad-hoc mutation), restricted to the selected cases. */
export function prepared(o: RunOptions = {}): { bundle: ModelBundle; caseIds: string[] } {
  const base = freshBundle();
  o.mutate?.(base);
  const v = applyVariants(base, o.variants ?? []);
  if (!v.ok) throw new Error(v.reasons.join('; '));
  const caseIds = o.cases ?? v.bundle.suites.find((s) => s.id === (o.suite ?? 'flagship'))!.caseIds;
  return { bundle: selectCases(v.bundle, caseIds), caseIds };
}

export function run(o: RunOptions = {}): AnalysisReport {
  const { bundle, caseIds } = prepared(o);
  return analyze(bundle, { automationIds: o.automations ?? [], controlIds: o.controls ?? [] }, caseIds, o.limits ?? DEFAULT_LIMITS);
}

export const hazards = (r: AnalysisReport, policy?: string) => r.findings.filter((f) => !policy || f.policyId === policy).map((f) => f.id);
