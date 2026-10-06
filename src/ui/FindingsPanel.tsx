import type { ReactNode } from 'react';
import type { AnalysisReport, DiffReport, Design, Finding, GoalFailure, SemanticAtom, Witness } from '../model/types';
import { plainFindingExplanation, plainGoalFailureExplanation } from './findingExplanations';
import { Badge, policyTone } from './Badge';
import { SlotStatus } from './SlotStatus';
import { useAppState, useDispatch } from './state';
import { useReasoner } from './useReasoner';
import { WitnessTable } from './WitnessTable';

interface WitnessEntry {
  id: string;
  label: string;
  witness: Witness;
}

const words = (s: string): string => s.replace(/_/g, ' ');

export function formatDesign(d: Design): string {
  const automations = d.automationIds.length > 0 ? d.automationIds.join(' + ') : 'manual (no automations)';
  const controls = d.controlIds.length > 0 ? d.controlIds.join(', ') : 'no added controls';
  return `${automations}; ${controls}`;
}

const atomLabel = (a: SemanticAtom): string =>
  `${a.source} → ${a.destination} (${a.authority}; purpose ${a.purpose}; evidence: ${a.evidence}; scope ${a.policyScope})`;

function collectEntries(report: AnalysisReport | null, diff: DiffReport | null, imported: Witness[]): WitnessEntry[] {
  const entries = new Map<string, WitnessEntry>();
  const addFinding = (f: Finding) => {
    if (!entries.has(f.id)) entries.set(f.id, { id: f.id, label: `${f.policyId} in case ${f.caseId} (${f.id})`, witness: f.witness });
  };
  if (diff) {
    [...diff.findings.introduced, ...diff.findings.persistent, ...diff.findings.resolved].forEach(addFinding);
  }
  if (report) {
    report.findings.forEach(addFinding);
    for (const g of report.goalFailures) {
      if (g.witness && !entries.has(g.id)) entries.set(g.id, { id: g.id, label: `Business goal in case ${g.caseId} (${g.id})`, witness: g.witness });
    }
  }
  for (const w of imported) {
    if (!entries.has(w.id)) entries.set(w.id, { id: w.id, label: `Imported witness ${w.id} (${w.policyId} in case ${w.caseId})`, witness: w });
  }
  return [...entries.values()];
}

function FindingRow({ finding, selectedId }: { finding: Finding; selectedId: string | null }) {
  const dispatch = useDispatch();
  const selected = selectedId === finding.id;
  return (
    <li className={`finding${selected ? ' is-selected' : ''}`}>
      <button type="button" className="finding__btn" aria-pressed={selected} onClick={() => dispatch({ type: 'select', selection: { type: 'finding', id: finding.id } })}>
        <Badge tone="bad">{finding.policyId} violated</Badge>
        <span className="finding__title">
          {finding.caseId} · {finding.id}
        </span>
        <span className="finding__plain">
          <strong>What this means:</strong> {plainFindingExplanation(finding)}
        </span>
        <span className="finding__technical">
          <strong>Technical event:</strong> {finding.message}
        </span>
      </button>
      <dl className="finding__meta">
        <dt>Mechanism code</dt>
        <dd>
          <code>{finding.mechanism}</code>
        </dd>
        {finding.enablingPatches.length > 0 ? (
          <>
            <dt>Enabling patches</dt>
            <dd>{finding.enablingPatches.join(', ')}</dd>
          </>
        ) : null}
        {finding.retainedSafeguards.length > 0 ? (
          <>
            <dt>Retained safeguards</dt>
            <dd>
              <ul>
                {finding.retainedSafeguards.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

function FindingGroup({ title, findings, selectedId, empty, note }: { title: string; findings: Finding[]; selectedId: string | null; empty: string; note?: string }) {
  return (
    <section className="results-group" aria-label={title}>
      <h4>
        {title} <span className="muted">({findings.length})</span>
      </h4>
      {note ? <p className="muted">{note}</p> : null}
      {findings.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="finding-list">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} selectedId={selectedId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AtomList({ title, atoms, empty }: { title: string; atoms: SemanticAtom[]; empty: ReactNode }) {
  return (
    <div className="results-group">
      <h5>
        {title} <span className="muted">({atoms.length})</span>
      </h5>
      {atoms.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="atom-list">
          {atoms.map((a) => (
            <li key={a.signature}>
              <span>{atomLabel(a)}</span>
              <code className="atom-list__sig">{a.signature}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Differential({ diff, selectedId }: { diff: DiffReport; selectedId: string | null }) {
  const removalNote = 'Not established: the analysis was partial, so an absent finding cannot be treated as removed.';
  return (
    <>
      <p className="results-compare">
        Baseline: <strong>{formatDesign(diff.baseline.design)}</strong> · Candidate: <strong>{formatDesign(diff.candidate.design)}</strong>
      </p>
      <FindingGroup
        title="Introduced"
        findings={diff.findings.introduced}
        selectedId={selectedId}
        empty="No candidate policy violation is absent from the reference results."
        note={
          diff.baseline.analysisStatus === 'complete'
            ? 'Policy violations reachable in the candidate but absent from the completely explored reference design. They show a newly broken rule; the workflow may still reach its business outcome.'
            : 'Confirmed policy violations in the candidate that were not reached in the incomplete reference analysis. Their absence from the reference is unknown, so causation by the candidate is not established.'
        }
      />
      <FindingGroup
        title="Persistent"
        findings={diff.findings.persistent}
        selectedId={selectedId}
        empty="No violation is present in both designs."
        note="Present in both the baseline and the candidate: not caused by the candidate's changes, but still reachable and still violating the policy."
      />
      {diff.completeForRemoval ? (
        <FindingGroup title="Resolved" findings={diff.findings.resolved} selectedId={selectedId} empty="No baseline violation is resolved by the candidate." />
      ) : (
        <section className="results-group" aria-label="Resolved">
          <h4>Resolved</h4>
          <p className="results-unknown">
            <Badge tone="warn">Unknown</Badge> Removals and resolutions are unknown. {removalNote}
          </p>
        </section>
      )}
      <section className="results-group" aria-label="Semantic flows">
        <h4>Semantic flows</h4>
        <AtomList title="Introduced flows" atoms={diff.atoms.introduced} empty="No new flow." />
        {diff.completeForRemoval ? (
          <AtomList title="Removed flows" atoms={diff.atoms.removed} empty="No flow removed." />
        ) : (
          <p className="results-unknown">
            <Badge tone="warn">Unknown</Badge> Removed flows are unknown. {removalNote}
          </p>
        )}
        <AtomList title="Retained flows" atoms={diff.atoms.retained} empty="No flow retained." />
      </section>
      {diff.notes.length > 0 ? (
        <section className="results-group" aria-label="Comparison notes">
          <h4>Comparison notes</h4>
          <ul>
            {diff.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function GoalFailureRow({ failure, selectedId }: { failure: GoalFailure; selectedId: string | null }) {
  const dispatch = useDispatch();
  const required = failure.required.kind === 'held' ? `held:${failure.required.reason}` : failure.required.kind;
  const body = (
    <>
      <Badge tone="bad">{words(failure.kind)}</Badge>
      <span className="finding__title">
        {failure.caseId} · {failure.id}
      </span>
      <span className="finding__plain">
        <strong>What this means:</strong> {plainGoalFailureExplanation(failure)}
      </span>
      <span className="finding__technical">
        <strong>Technical event:</strong> {failure.message}
      </span>
      <span className="finding__technical">
        <strong>Typed outcome:</strong> kind=<code>{failure.kind}</code>; required=<code>{required}</code>; actual=<code>{failure.actual}</code>
      </span>
    </>
  );
  return (
    <li className={`finding${selectedId === failure.id ? ' is-selected' : ''}`}>
      {failure.witness ? (
        <button type="button" className="finding__btn" aria-pressed={selectedId === failure.id} onClick={() => dispatch({ type: 'select', selection: { type: 'finding', id: failure.id } })}>
          {body}
        </button>
      ) : (
        <div className="finding__btn finding__btn--static">
          {body}
          <span className="finding__technical">No witness execution is attached to this failure.</span>
        </div>
      )}
    </li>
  );
}

function ResultKindsExplanation() {
  return (
    <section className="result-kinds" aria-labelledby="result-kinds-title">
      <h4 id="result-kinds-title">Policy violations and business-goal failures are different</h4>
      <div className="result-kinds__grid">
        <p>
          <strong>Policy violation:</strong> A reachable path breaks a rule such as verifying bank details. <strong>Introduced</strong> means the candidate has a confirmed violation that was not reached in the reference analysis; only a complete reference search establishes that the reference lacks it.
        </p>
        <p>
          <strong>Business-goal failure:</strong> The workflow does not deliver a required outcome—for example, it gets stuck, holds a valid case, ends incorrectly or pays twice.
        </p>
      </div>
      <p className="muted">These are independent checks. A workflow can finish while breaking a policy, or obey every monitored policy but still fail to finish correctly.</p>
    </section>
  );
}

function AnalysisView({ report, diff, selectedId }: { report: AnalysisReport; diff: DiffReport | null; selectedId: string | null }) {
  return (
    <>
      <section className="results-group" aria-label="Policy results">
        <h4>Policy results for this design</h4>
        <ul className="policy-results">
          {report.policies.map((p) => (
            <li key={p.policyId}>
              <Badge tone={policyTone(p.status)}>{`${p.policyId}: ${words(p.status)}`}</Badge>
              <span>
                <strong>{p.name}</strong> — {p.reason}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <ResultKindsExplanation />

      {report.analysisStatus === 'invalid' ? (
        <section className="results-group results-unknown" role="alert">
          <h4>Invalid input — no assurance is claimed</h4>
          <ul>
            {report.invalidReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.analysisStatus === 'partial' ? (
        <section className="results-group results-unknown" role="status">
          <h4>Partial coverage — an absent witness is unknown, not satisfied</h4>
          <p>The exploration stopped before the finite model was exhausted. Violations listed below are confirmed; every policy without a witness remains unknown.</p>
          <ul>
            {report.incompleteReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {diff ? (
        <Differential diff={diff} selectedId={selectedId} />
      ) : (
        <FindingGroup title="Findings in this design" findings={report.findings} selectedId={selectedId} empty={report.analysisStatus === 'complete' ? 'No policy violation is reachable in the explored finite model.' : 'No violation witnessed; this is not a pass because coverage is not complete.'} />
      )}

      <section className="results-group" aria-label="Business-goal failures">
        <h4>
          Business-goal failures <span className="muted">({report.goalFailures.length})</span>
        </h4>
        <p className="muted">
          These are outcome failures, not comparison labels: a case did not finish as required. They can occur with or without an introduced policy violation.
        </p>
        {report.goalFailures.length === 0 ? (
          <p className="muted">{report.goalStatus === 'satisfied' ? 'Every legitimate case ends in its required outcome on every terminal execution.' : 'No goal failure witnessed.'}</p>
        ) : (
          <ul className="finding-list">
            {report.goalFailures.map((g) => (
              <GoalFailureRow key={g.id} failure={g} selectedId={selectedId} />
            ))}
          </ul>
        )}
      </section>

      <section className="results-group" aria-label="Technical capability excess">
        <h4>Technical capability excess (not witnessed executions)</h4>
        <p className="muted">These grants exceed the declared use. They are technical possibilities noted for review; they are not executions the engine witnessed.</p>
        {report.capabilityNotices.length === 0 ? (
          <p className="muted">No capability exceeds its declared use.</p>
        ) : (
          <ul className="notice-list">
            {report.capabilityNotices.map((n) => (
              <li key={`${n.grantId}:${n.principalId}`}>
                <strong>{n.principalId}</strong> can {n.operation} {n.resource} in {n.system} (grant {n.grantId}) — {n.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ReplayStatus({ witnessId }: { witnessId: string }) {
  const { replay } = useAppState();
  if (!replay || replay.witnessId !== witnessId) return null;
  if (replay.status === 'running') {
    return (
      <p className="replay" role="status">
        Replaying witness through the engine…
      </p>
    );
  }
  if (replay.status === 'failed' || !replay.result) {
    return (
      <p className="replay replay--rejected" role="alert">
        <Badge tone="bad">Replay failed</Badge> {replay.message ?? 'The replay did not return a result.'}
      </p>
    );
  }
  const r = replay.result;
  if (r.status === 'verified') {
    const at = r.violation ? `${r.violation.policyId} violation confirmed at step ${r.violation.stepIndex + 1}` : 'violation confirmed';
    return (
      <p className="replay replay--verified" role="status">
        <Badge tone="info">Replay verified</Badge> {`Witness verified: every step enabled; ${at}`}
      </p>
    );
  }
  return (
    <div className="replay replay--rejected" role="alert">
      <p>
        <Badge tone="bad">Replay rejected</Badge> Witness rejected after {r.verifiedSteps} verified step(s){r.failingStepIndex !== null ? `; failing step ${r.failingStepIndex + 1}` : ''}.
      </p>
      <ul>
        {r.reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

function WitnessDetail({ entry }: { entry: WitnessEntry }) {
  const reasoner = useReasoner();
  return (
    <section className="results-group witness-detail" aria-label="Selected witness">
      <h4>Witness: {entry.label}</h4>
      <p className="muted">
        Case {entry.witness.caseId}. Replay regenerates the enabled transitions from the declared initial state and confirms the final violation; altered steps are rejected.
      </p>
      <div className="results-actions">
        <button type="button" className="btn btn--primary" disabled={reasoner.busy} onClick={() => reasoner.replay(entry.witness)}>
          Replay witness
        </button>
      </div>
      <ReplayStatus witnessId={entry.witness.id} />
      <WitnessTable witness={entry.witness} findingId={entry.id} />
    </section>
  );
}

function ImportedWitnesses({ witnesses, selectedId }: { witnesses: Witness[]; selectedId: string | null }) {
  const dispatch = useDispatch();
  return (
    <section className="results-group" aria-label="Imported witnesses">
      <h4>
        Imported witnesses <span className="muted">({witnesses.length})</span>
      </h4>
      <p className="muted">Restored from an imported report. They are claims until replayed against the restored model and design.</p>
      <ul className="finding-list">
        {witnesses.map((w) => (
          <li key={w.id} className={`finding${selectedId === w.id ? ' is-selected' : ''}`}>
            <button type="button" className="finding__btn" aria-pressed={selectedId === w.id} onClick={() => dispatch({ type: 'select', selection: { type: 'finding', id: w.id } })}>
              <Badge tone="neutral">{w.policyId}</Badge>
              <span className="finding__title">
                {w.caseId} · {w.id}
              </span>
              <span className="finding__msg">{w.violation.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FindingsPanel() {
  const state = useAppState();
  const { analysis, diff } = state;
  const report = analysis.status === 'done' ? analysis.value : null;
  const diffReport = diff.status === 'done' ? diff.value : null;
  const entries = collectEntries(report, diffReport, state.importedWitnesses);
  const sel = state.selection;
  const selectedId = sel?.type === 'finding' ? sel.id : sel?.type === 'step' ? sel.findingId : null;
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="results-stack">
      <SlotStatus slot={analysis} idle="Run Analyze to see findings." subject="Analysis" />
      {diff.status === 'running' || diff.status === 'failed' || diff.status === 'cancelled' ? <SlotStatus slot={diff} idle={null} subject="Comparison" /> : null}
      {report ? <AnalysisView report={report} diff={diffReport} selectedId={selectedId} /> : null}
      {state.importedWitnesses.length > 0 ? <ImportedWitnesses witnesses={state.importedWitnesses} selectedId={selectedId} /> : null}
      {selected ? <WitnessDetail entry={selected} /> : null}
    </div>
  );
}
