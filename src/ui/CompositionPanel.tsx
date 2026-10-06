import type { CompositionReport, CompositionSubset, HazardMinimality } from '../model/types';
import { analysisTone, Badge, goalTone, policyTone, type Tone } from './Badge';
import { SlotStatus } from './SlotStatus';
import { useAppState, useDispatch } from './state';
import { useReasoner } from './useReasoner';

const words = (s: string): string => s.replace(/_/g, ' ');
const subsetLabel = (ids: readonly string[]): string => (ids.length === 0 ? 'None' : ids.join(' + '));
const setLabel = (ids: readonly string[]): string => `{${ids.join(', ')}}`;
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const MINIMALITY: Record<HazardMinimality['status'], { tone: Tone; text: string }> = {
  established: { tone: 'info', text: 'Minimal set established' },
  unknown: { tone: 'warn', text: 'Minimality unknown — not claimed' },
  not_minimal_only: { tone: 'neutral', text: 'Reachable only in non-minimal sets' },
};

function Matrix({ subsets }: { subsets: CompositionSubset[] }) {
  return (
    <div className="results-scroll" role="region" aria-label="Composition matrix scroll area" tabIndex={0}>
      <table className="table composition-matrix" aria-label="All automation subsets">
        <thead>
          <tr>
            <th scope="col">Automations</th>
            <th scope="col">Analysis</th>
            <th scope="col">Policies</th>
            <th scope="col">Goals</th>
            <th scope="col">Hazards reached</th>
          </tr>
        </thead>
        <tbody>
          {subsets.map((s) => (
            <tr key={s.automationIds.join('+') || 'none'}>
              <th scope="row">{subsetLabel(s.automationIds)}</th>
              <td>
                <Badge tone={analysisTone(s.analysisStatus)}>{words(s.analysisStatus)}</Badge>
              </td>
              <td>
                <Badge tone={policyTone(s.policyStatus)}>{words(s.policyStatus)}</Badge>
              </td>
              <td>
                <Badge tone={goalTone(s.goalStatus)}>{words(s.goalStatus)}</Badge>
              </td>
              <td>{s.hazardIds.length > 0 ? s.hazardIds.join(', ') : <span className="muted">none</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HazardExplanation({ hazard, report }: { hazard: HazardMinimality; report: CompositionReport }) {
  const firstReachable = hazard.reachableIn[0];
  const firstSubset = firstReachable ? report.subsets.find((s) => sameSet(s.automationIds, firstReachable)) : undefined;
  const finding = firstSubset?.report.findings.find((f) => f.id === hazard.hazardId);
  // an absence claim requires that subset's own analysis to be complete
  const safe = report.subsets.filter((s) => s.analysisStatus === 'complete' && !hazard.reachableIn.some((r) => sameSet(r, s.automationIds)));
  return (
    <div className="hazard__explain">
      <p>
        Reachable in {hazard.reachableIn.length} subset(s): {hazard.reachableIn.map(setLabel).join(', ')}.
        {safe.length > 0 ? ` Complete and free of this hazard in: ${safe.map((s) => setLabel(s.automationIds)).join(', ')}.` : ''}
      </p>
      {hazard.unknownSubsets.length > 0 ? <p className="results-unknown">Unknown (incomplete) subsets: {hazard.unknownSubsets.map(setLabel).join(', ')}.</p> : null}
      {finding ? (
        <>
          <p>
            Witnessed in {setLabel(firstReachable ?? [])}: {finding.message}
          </p>
          {finding.retainedSafeguards.length > 0 ? (
            <>
              <p className="hazard__heading">Safeguards still retained in that subset</p>
              <ul>
                {finding.retainedSafeguards.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Hazards({ report }: { report: CompositionReport }) {
  if (report.hazards.length === 0) {
    return (
      <p className="muted">
        {report.analysisStatus === 'complete' ? 'No hazard is reachable in any of the eight subsets.' : 'No hazard was witnessed, but coverage is not complete, so this is not a pass.'}
      </p>
    );
  }
  return (
    <ul className="hazard-list">
      {report.hazards.map((h) => {
        const m = MINIMALITY[h.status];
        return (
          <li key={h.hazardId} className="hazard">
            <div className="hazard__head">
              <strong>{h.hazardId}</strong>
              <span className="muted">
                {h.policyId} · case {h.caseId} · {h.mechanism}
              </span>
              <Badge tone={m.tone}>{m.text}</Badge>
            </div>
            <p>
              {h.status === 'established' ? (
                <>
                  Minimal enabling set{h.minimalSets.length === 1 ? '' : 's'}: <strong>{h.minimalSets.map(setLabel).join(', ')}</strong>
                </>
              ) : (
                <strong>Minimality is NOT claimed for this hazard.</strong>
              )}
            </p>
            <p className="muted">{h.note}</p>
            <HazardExplanation hazard={h} report={report} />
          </li>
        );
      })}
    </ul>
  );
}

export function CompositionPanel() {
  const { composition } = useAppState();
  const dispatch = useDispatch();
  const reasoner = useReasoner();
  const report = composition.status === 'done' ? composition.value : null;

  return (
    <div className="results-stack">
      <div className="results-actions">
        <button type="button" className="btn btn--primary" disabled={reasoner.busy} onClick={reasoner.runComposition}>
          Run composition
        </button>
        <span className="muted">Analyzes all eight subsets of A1–A3 against the active cases with baseline controls.</span>
      </div>
      <SlotStatus
        slot={composition}
        idle="Run composition to analyze every subset of the automations A1–A3 and find which combination enables a policy violation. Nothing is shown until the analysis has run."
        subject="Composition"
      />
      {report ? (
        <>
          {report.analysisStatus !== 'complete' ? (
            <section className="results-group results-unknown" role="status">
              <h4>
                <Badge tone={analysisTone(report.analysisStatus)}>{`Composition coverage: ${report.analysisStatus}`}</Badge> Absent hazards are unknown, not satisfied
              </h4>
              <ul>
                {report.incompleteReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="results-group" aria-label="Subset results">
            <h4>All eight automation subsets</h4>
            <Matrix subsets={report.subsets} />
          </section>
          <section className="results-group" aria-label="Minimal enabling sets">
            <h4>Minimal enabling sets</h4>
            <p className="muted">A set is minimal only when the hazard is reachable in it and every proper subset was checked complete and free of the hazard.</p>
            <Hazards report={report} />
          </section>
          <section className="results-group" aria-label="Three separate results">
            <h4>Three separate results</h4>
            <ul className="results-three">
              <li>
                <strong>Shortest execution witness</strong> — one replayable path to a violation in a single design.{' '}
                <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'setTab', tab: 'findings' })}>
                  Open Findings
                </button>
              </li>
              <li>
                <strong>Minimal automation set</strong> — the smallest combination of automations that enables the hazard (shown above).
              </li>
              <li>
                <strong>Cheapest repair</strong> — the verified control set with the lowest cost or disruption.{' '}
                <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'setTab', tab: 'repairs' })}>
                  Open Repairs
                </button>
              </li>
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
