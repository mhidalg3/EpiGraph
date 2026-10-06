import { useEffect, useMemo, useState } from 'react';
import { buildReportEnvelope, computeHashes, type ReportEnvelope, type ReportInputs } from '../engine/report';
import type { ReportHashes } from '../workers/protocol';
import { useAppState, type AppState } from './state';

function reportInputs(state: AppState): ReportInputs {
  const baselineDiffers =
    state.baselineAutomationIds.length !== state.design.automationIds.length || state.baselineAutomationIds.some((id, i) => id !== state.design.automationIds[i]);
  return {
    model: state.bundle,
    variantIds: state.variantIds,
    design: state.design,
    caseIds: state.caseIds,
    limits: state.limits,
    objective: state.objective,
    ...(baselineDiffers ? { baselineDesign: { automationIds: state.baselineAutomationIds, controlIds: [] } } : {}),
  };
}

/**
 * The exportable report for the CURRENT inputs and completed results; null until a real analysis finished.
 * Hashes are recomputed from the embedded inputs (e.g. after an economics edit) so they always match the embedded model.
 */
export function useCurrentEnvelope(): ReportEnvelope | null {
  const state = useAppState();
  const { bundle, variantIds, design, caseIds, limits, objective, baselineAutomationIds, analysis, diff, composition, synthesis, replay } = state;
  const done = analysis.status === 'done';
  // the inputs object is derived from exactly the fields listed in the dependency array
  const inputs = useMemo(() => (done ? reportInputs(state) : null), [done, bundle, variantIds, design, caseIds, limits, objective, baselineAutomationIds]);
  const [hashed, setHashed] = useState<{ inputs: ReportInputs; hashes: ReportHashes } | null>(null);
  useEffect(() => {
    if (!inputs) return;
    let live = true;
    void computeHashes(inputs).then((hashes) => {
      if (live) setHashed({ inputs, hashes });
    });
    return () => {
      live = false;
    };
  }, [inputs]);
  return useMemo(() => {
    if (!inputs || analysis.status !== 'done' || hashed?.inputs !== inputs) return null;
    return buildReportEnvelope({
      inputs,
      hashes: hashed.hashes,
      analysis: analysis.value,
      ...(diff.status === 'done' ? { diff: diff.value } : {}),
      ...(composition.status === 'done' ? { composition: composition.value } : {}),
      ...(synthesis.status === 'done' ? { synthesis: synthesis.value } : {}),
      ...(replay?.status === 'done' && replay.result ? { replay: { witnessId: replay.witnessId, result: replay.result } } : {}),
    });
  }, [inputs, hashed, analysis, diff, composition, synthesis, replay]);
}

export function exportFileName(prefix: string, ext: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
}

export function downloadText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
