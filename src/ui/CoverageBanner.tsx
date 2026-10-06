import type { AnalysisReport } from '../model/types';
import type { ReportHashes } from '../workers/protocol';
import { analysisTone, Badge, goalTone, policyTone } from './Badge';
import { useAppState, type AppState } from './state';

const words = (s: string): string => s.replace(/_/g, ' ');
const list = (ids: string[]): string => (ids.length === 0 ? 'none (manual)' : ids.join(', '));

function Done({ report, hashes, durationMs }: { report: AnalysisReport; hashes: ReportHashes; durationMs: number }) {
  const caseCounts = report.cases.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
  const eff = report.effective;
  const requested = list(eff.requestedAutomationIds);
  const effective = list(eff.effectiveAutomationIds);
  return (
    <>
      <div className="row coverage__badges">
        <Badge tone={analysisTone(report.analysisStatus)}>{`Coverage: ${words(report.analysisStatus)}`}</Badge>
        <Badge tone={policyTone(report.policyStatus)}>{`Policies: ${words(report.policyStatus)}`}</Badge>
        <Badge tone={goalTone(report.goalStatus)}>{`Goals: ${words(report.goalStatus)}`}</Badge>
      </div>
      {report.analysisStatus === 'invalid' && (
        <div role="alert">
          <strong>Invalid model or request — no exploration result:</strong>
          <ul>
            {report.invalidReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {report.analysisStatus === 'partial' && (
        <div>
          <strong>Incomplete coverage. Absence of a witness is unknown, not a pass.</strong>
          <ul>
            {report.incompleteReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {requested !== effective && (
        <p>
          Requested automations: <span className="num">{requested}</span>; effective after controls: <span className="num">{effective}</span>.
        </p>
      )}
      <dl className="coverage__facts">
        <dt>States / transitions</dt>
        <dd className="num">
          {report.totals.states.toLocaleString('en-US')} / {report.totals.transitions.toLocaleString('en-US')}
        </dd>
        <dt>Cases</dt>
        <dd>{Object.entries(caseCounts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}</dd>
        <dt>Duration</dt>
        <dd className="num">{durationMs.toFixed(0)} ms (observed)</dd>
      </dl>
      <dl className="coverage__facts coverage__facts--wide">
        <dt>Versions</dt>
        <dd className="num">
          engine {report.engineVersion} · graph {report.graphVersion} · policy {report.policyVersion}
        </dd>
        <dt>Analysis date</dt>
        <dd className="num">{report.analysisDate}</dd>
        <dt>Hashes ({hashes.algorithm})</dt>
        <dd className="num">
          model {hashes.modelHash.slice(0, 12)} · design {hashes.designHash.slice(0, 12)} · policy {hashes.policyHash.slice(0, 12)}
        </dd>
      </dl>
    </>
  );
}

function announcement(a: AppState['analysis']): string {
  if (a.status === 'running') return `Analysis running: ${a.completed} of ${a.total}`;
  if (a.status === 'failed') return `Analysis failed: ${a.message}`;
  if (a.status === 'cancelled') return 'Analysis cancelled; no result';
  if (a.status === 'done') return `Analysis finished. Coverage ${words(a.value.analysisStatus)}, policies ${words(a.value.policyStatus)}, goals ${words(a.value.goalStatus)}.`;
  return '';
}

export function CoverageBanner() {
  const { analysis } = useAppState();
  return (
    <section className="panel coverage" data-testid="coverage-banner" aria-label="Analysis coverage">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement(analysis)}
      </p>
      {analysis.status === 'idle' && <p className="muted">No analysis yet</p>}
      {analysis.status === 'running' && (
        <div aria-live="polite">
          <p>
            {analysis.label}: <span className="num">{analysis.completed}/{analysis.total}</span>
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-label={analysis.label}
            aria-valuemin={0}
            aria-valuemax={analysis.total}
            aria-valuenow={analysis.completed}
          >
            <div className="progress__bar" style={{ width: `${analysis.total > 0 ? (100 * analysis.completed) / analysis.total : 0}%` }} />
          </div>
        </div>
      )}
      {analysis.status === 'failed' && (
        <p role="alert">
          <Badge tone="bad">Analysis failed</Badge> {analysis.message}
        </p>
      )}
      {analysis.status === 'cancelled' && (
        <p>
          <Badge tone="neutral">Analysis cancelled — no result</Badge>
        </p>
      )}
      {analysis.status === 'done' && <Done report={analysis.value} hashes={analysis.hashes} durationMs={analysis.durationMs} />}
    </section>
  );
}
