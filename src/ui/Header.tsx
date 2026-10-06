import { useRef, type ChangeEvent } from 'react';
import { MAX_REPORT_BYTES, parseReportEnvelope, reportToMarkdown } from '../engine/report';
import { MAX_IMPORT_BYTES, parseBundle } from '../model/validate';
import { downloadText, exportFileName, useCurrentEnvelope } from './exportReport';
import { useAppState, useDispatch } from './state';

const NEEDS_ANALYSIS = 'Run Analyze first';

export function Header() {
  const state = useAppState();
  const dispatch = useDispatch();
  const modelInput = useRef<HTMLInputElement>(null);
  const reportInput = useRef<HTMLInputElement>(null);
  const envelope = useCurrentEnvelope();

  const readFile = async (e: ChangeEvent<HTMLInputElement>, limit: number | null): Promise<string | null> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return null;
    if (limit !== null && file.size > limit) {
      dispatch({ type: 'notice', notice: { kind: 'error', text: `${file.name} is ${file.size} bytes; the import limit is ${limit} bytes. Current model unchanged.` } });
      return null;
    }
    return file.text();
  };

  const importModel = async (e: ChangeEvent<HTMLInputElement>) => {
    const text = await readFile(e, MAX_IMPORT_BYTES);
    if (text === null) return;
    const parsed = parseBundle(text);
    if (!parsed.ok) {
      dispatch({ type: 'notice', notice: { kind: 'error', text: `Model rejected; current model unchanged. ${parsed.reasons.slice(0, 3).join(' • ')}` } });
      return;
    }
    dispatch({ type: 'loadBundle', bundle: parsed.bundle, source: 'imported' });
    dispatch({ type: 'notice', notice: { kind: 'info', text: 'Model imported; run Analyze to evaluate it.' } });
  };

  const importReport = async (e: ChangeEvent<HTMLInputElement>) => {
    const text = await readFile(e, MAX_REPORT_BYTES);
    if (text === null) return;
    const parsed = parseReportEnvelope(text);
    if (!parsed.ok) {
      dispatch({ type: 'notice', notice: { kind: 'error', text: `Report rejected; current model unchanged. ${parsed.error}` } });
      return;
    }
    const { inputs } = parsed.envelope;
    dispatch({
      type: 'loadBundle',
      bundle: inputs.model,
      source: 'imported',
      design: inputs.design,
      variantIds: inputs.variantIds,
      caseIds: inputs.caseIds,
      limits: inputs.limits,
      witnesses: parsed.witnesses,
      ...(inputs.baselineDesign ? { baselineAutomationIds: inputs.baselineDesign.automationIds } : {}),
      ...(inputs.objective ? { objective: inputs.objective } : {}),
    });
    dispatch({ type: 'notice', notice: { kind: 'info', text: 'Report inputs restored; run Analyze to reproduce' } });
  };

  return (
    <header className="app-header">
      <div className="app-header__title">
        <h1>Workflow Assurance Lab</h1>
        <span className="app-header__org">Northstar</span>
        <span className="app-header__scope">Fictional finite-model demonstration</span>
      </div>
      <div className="app-header__actions row">
        <button type="button" className="btn" onClick={() => modelInput.current?.click()}>
          Import model
        </button>
        <button type="button" className="btn" onClick={() => reportInput.current?.click()}>
          Import report
        </button>
        <button type="button" className="btn" onClick={() => downloadText(exportFileName('northstar-model', 'json'), 'application/json', JSON.stringify(state.bundle, null, 2))}>
          Export model JSON
        </button>
        <button
          type="button"
          className="btn"
          disabled={!envelope}
          title={envelope ? undefined : NEEDS_ANALYSIS}
          aria-describedby={envelope ? undefined : 'export-reason'}
          onClick={() => envelope && downloadText(exportFileName('assurance-report', 'json'), 'application/json', JSON.stringify(envelope, null, 2))}
        >
          Export report JSON
        </button>
        <button
          type="button"
          className="btn"
          disabled={!envelope}
          title={envelope ? undefined : NEEDS_ANALYSIS}
          aria-describedby={envelope ? undefined : 'export-reason'}
          onClick={() => envelope && downloadText(exportFileName('assurance-report', 'md'), 'text/markdown', reportToMarkdown(envelope))}
        >
          Export report Markdown
        </button>
        {!envelope && (
          <span id="export-reason" className="muted app-header__reason">
            {NEEDS_ANALYSIS}
          </span>
        )}
        <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'reset' })}>
          Reset
        </button>
        <input ref={modelInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Import model JSON file" tabIndex={-1} onChange={(e) => void importModel(e)} />
        <input ref={reportInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Import report JSON file" tabIndex={-1} onChange={(e) => void importReport(e)} />
      </div>
      <div className="notices" aria-live="polite">
        {state.notices.map((n, i) => (
          <div key={i} className={`notice notice--${n.kind}`} role={n.kind === 'error' ? 'alert' : undefined}>
            <span>{n.text}</span>
          </div>
        ))}
        {state.notices.length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'dismissNotices' })}>
            Dismiss
          </button>
        )}
      </div>
    </header>
  );
}
