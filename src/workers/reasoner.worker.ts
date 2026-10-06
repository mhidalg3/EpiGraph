import { analyze, analyzeComposition, applyVariants, compare, replayWitness, selectCases, synthesize } from '../engine';
import { computeHashes } from '../engine/report';
import { parseBundle } from '../model/validate';
import type { ModelBundle } from '../model/types';
import type { ReasonerRequest, ReasonerResponse, ReasonerResultData } from './protocol';

interface WorkerScope {
  postMessage(message: ReasonerResponse): void;
  onmessage: ((ev: MessageEvent<ReasonerRequest>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

function prepare(req: ReasonerRequest): ModelBundle {
  const parsed = parseBundle(req.bundle);
  if (!parsed.ok) throw new Error(`Model rejected by the engine: ${parsed.reasons.slice(0, 5).join('; ')}`);
  const v = applyVariants(parsed.bundle, req.variantIds);
  if (!v.ok) throw new Error(`Variant patches rejected: ${v.reasons.join('; ')}`);
  return selectCases(v.bundle, req.caseIds);
}

function run(req: ReasonerRequest, bundle: ModelBundle): ReasonerResultData {
  const progress = (completed: number, total: number, label: string) =>
    ctx.postMessage({ type: 'progress', requestId: req.requestId, completed, total, label });
  switch (req.kind) {
    case 'analyze': {
      progress(0, 1, 'analyzing cases');
      const report = analyze(bundle, req.design, req.caseIds, req.limits);
      progress(1, 1, 'done');
      return { kind: 'analyze', report };
    }
    case 'compare': {
      progress(0, 2, 'analyzing baseline');
      const diff = compare(bundle, req.baseline, req.candidate, req.caseIds, req.limits);
      progress(2, 2, 'done');
      return { kind: 'compare', diff };
    }
    case 'composition':
      return { kind: 'composition', composition: analyzeComposition(bundle, req.candidateIds, req.caseIds, req.limits, progress) };
    case 'synthesize':
      return { kind: 'synthesize', synthesis: synthesize(bundle, req.design, req.objective, req.limits, progress) };
    case 'replay':
      return { kind: 'replay', replay: replayWitness(bundle, req.design, req.witness) };
  }
}

ctx.onmessage = (ev) => {
  const req = ev.data;
  const started = performance.now();
  void (async () => {
    try {
      const bundle = prepare(req);
      const data = run(req, bundle);
      const durationMs = performance.now() - started;
      if (data.kind === 'analyze') data.report.durationMs = durationMs;
      if (data.kind === 'synthesize') data.synthesis.durationMs = durationMs;
      const design = 'design' in req ? req.design : 'candidate' in req ? req.candidate : { automationIds: [], controlIds: [] };
      const hashes = await computeHashes({ model: req.bundle, variantIds: req.variantIds, design, caseIds: req.caseIds, limits: req.limits });
      ctx.postMessage({ type: 'result', requestId: req.requestId, data, hashes, durationMs });
    } catch (e) {
      ctx.postMessage({ type: 'error', requestId: req.requestId, message: (e as Error).message });
    }
  })();
};
