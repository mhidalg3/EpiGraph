import { useEffect, useRef } from 'react';
import type { Design, ModelBundle, OptimizationStatus, SynthesisCandidate, SynthesisReport } from '../model/types';
import { analysisTone, Badge, goalTone, optimizationTone, policyTone, usd, type Tone } from './Badge';
import { formatDesign } from './FindingsPanel';
import { SlotStatus } from './SlotStatus';
import { useAppState, useDispatch } from './state';
import { useReasoner } from './useReasoner';

const words = (s: string): string => s.replace(/_/g, ' ');
const list = (ids: readonly string[], none = 'none'): string => (ids.length === 0 ? none : ids.join(', '));
const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const VERDICT: Record<SynthesisCandidate['verdict'], { tone: Tone; text: string }> = {
  accepted: { tone: 'ok', text: 'Accepted' },
  rejected: { tone: 'bad', text: 'Rejected' },
  unknown: { tone: 'warn', text: 'Unknown' },
};

/**
 * Applies a verified repair design: sets the design (which clears every stale result), then — once the state holds exactly
 * that design with no analysis — starts one real re-analysis. Mount it in a component that outlives the Repairs tab.
 */
export function useApplyRepair(): (design: Design) => void {
  const state = useAppState();
  const dispatch = useDispatch();
  const reasoner = useReasoner();
  const pending = useRef<Design | null>(null);

  useEffect(() => {
    const target = pending.current;
    if (target && sameIds(state.design.automationIds, target.automationIds) && sameIds(state.design.controlIds, target.controlIds) && state.analysis.status === 'idle') {
      pending.current = null;
      reasoner.analyze();
    }
  }, [state.design, state.analysis.status, reasoner]);

  return (design) => {
    const target = { automationIds: [...design.automationIds].sort(), controlIds: [...design.controlIds].sort() };
    pending.current = target;
    dispatch({ type: 'setDesign', design: target });
    dispatch({ type: 'notice', notice: { kind: 'info', text: `Applied repair design (${formatDesign(target)}); re-running analysis.` } });
    dispatch({ type: 'setTab', tab: 'findings' });
  };
}

function automationsText(c: SynthesisCandidate, bundle: ModelBundle): string {
  if (sameIds(c.automationIds, c.effectiveAutomationIds)) return list(c.automationIds, 'none (manual)');
  const revoked = c.automationIds.filter((id) => !c.effectiveAutomationIds.includes(id));
  const revokers = c.appliedControlIds.filter((id) => bundle.repairs.find((r) => r.id === id)?.patch.some((op) => op.op === 'removeCapability'));
  const cause = revokers.length > 0 ? ` (${revokers.join(', ')} revokes ${revoked.length === 1 ? 'it' : 'them'})` : '';
  return `${revoked.join(', ')} requested, not effective${cause}; effective: ${list(c.effectiveAutomationIds)}`;
}

function controlsText(c: SynthesisCandidate): string {
  const inapplicable = c.controlIds.filter((id) => !c.appliedControlIds.includes(id) && !c.noopControlIds.includes(id));
  const parts = [`applied: ${list(c.appliedControlIds)}`];
  if (c.noopControlIds.length > 0) parts.push(`no-op (already present): ${c.noopControlIds.join(', ')}`);
  if (inapplicable.length > 0) parts.push(`inapplicable: ${inapplicable.join(', ')}`);
  return parts.join('; ');
}

function CandidateRow({ c, role, isBest, bundle, onApply }: { c: SynthesisCandidate; role: 'requested' | 'candidate'; isBest: boolean; bundle: ModelBundle; onApply: (d: Design) => void }) {
  const v = VERDICT[c.verdict];
  const econ = c.economics;
  const budget = bundle.economics.reviewCapacityHours;
  const headId = `cand-${c.key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const ineligible = role === 'requested' && c.verdict !== 'accepted';
  return (
    <tr className={isBest ? 'is-best' : undefined}>
      <th scope="row" id={headId}>
        {role === 'requested' ? <strong>Requested design</strong> : <span>Candidate</span>}
        {isBest ? (
          <div>
            <Badge tone="ok">Best verified candidate</Badge>
          </div>
        ) : null}
        {ineligible ? (
          <div>
            <Badge tone="bad">Ineligible — unrankable</Badge>
          </div>
        ) : null}
        {role === 'candidate' ? <div className="muted">{c.applicability}</div> : null}
      </th>
      <td>{automationsText(c, bundle)}</td>
      <td>{controlsText(c)}</td>
      <td>
        <Badge tone={v.tone}>{v.text}</Badge>
      </td>
      <td>
        <Badge tone={policyTone(c.policyStatus)}>{words(c.policyStatus)}</Badge>
        {c.hazardIds.length > 0 ? <div className="muted">{c.hazardIds.join(', ')}</div> : null}
      </td>
      <td>
        <Badge tone={goalTone(c.goalStatus)}>{words(c.goalStatus)}</Badge>
      </td>
      <td>
        {econ ? (
          <>
            <span className="num">
              {econ.addedReviewHours.toFixed(2)} h of {budget} h
            </span>
            <div>
              <Badge tone={c.capacityOk ? 'ok' : 'bad'}>{c.capacityOk ? 'within budget' : 'exceeds budget'}</Badge>
            </div>
          </>
        ) : (
          <Badge tone="warn">unavailable</Badge>
        )}
      </td>
      <td className="num">{econ ? usd(econ.netValueUsd) : 'n/a'}</td>
      <td className="num">{econ ? usd(econ.disruptionUsd) : 'n/a'}</td>
      <td className="num">{econ ? econ.changedElements : 'n/a'}</td>
      <td>
        {c.rejectionReasons.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          <ul className="witness-list">
            {c.rejectionReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </td>
      <td>
        {c.verdict === 'accepted' && role === 'candidate' ? (
          <button type="button" className="btn btn--primary" aria-describedby={headId} onClick={() => onApply({ automationIds: c.automationIds, controlIds: c.controlIds })}>
            Apply repair
          </button>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}

function CoverageCounts({ report }: { report: SynthesisReport }) {
  const c = report.coverage;
  const items: [string, string | number][] = [
    ['Raw combinations', c.rawCombinations],
    ['Applicable', c.applicable],
    ['No-op', c.noop],
    ['Inapplicable', c.inapplicable],
    ['Conflicting', c.conflicting],
    ['Deduplicated', c.deduplicated],
    ['Rechecked', c.rechecked],
    ['Accepted', c.accepted],
    ['Rejected', c.rejected],
    ['Unknown', c.unknown],
    ['Truncated by maxDesigns', c.truncatedByMaxDesigns ? 'yes' : 'no'],
  ];
  return (
    <dl className="coverage-counts" aria-label="Search coverage">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="num">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const OPTIMIZATION_HELP: Record<OptimizationStatus, string> = {
  optimal_in_catalog: 'Every candidate in the finite catalog was verified; no cheaper or higher-value verified design exists in it.',
  best_verified_found: 'The best verified design is listed, but unverified or unenumerated candidates remain that could rank better.',
  no_feasible_design: 'The whole finite catalog was verified and every candidate was rejected.',
  unknown: 'No design was verified and some candidates are unknown, so feasibility is not decided.',
};

function Results({ report, onApply }: { report: SynthesisReport; onApply: (d: Design) => void }) {
  const { bundle, design } = useAppState();
  const unrepaired = report.unrepaired;
  const rest = report.candidates.filter((c) => c.key !== unrepaired?.key);
  return (
    <>
      <section className="results-group" aria-label="Search status">
        <div className="results-badges">
          <Badge tone={optimizationTone(report.optimizationStatus)}>{`Optimization: ${words(report.optimizationStatus)}`}</Badge>
          <Badge tone={analysisTone(report.analysisStatus)}>{`Coverage: ${report.analysisStatus}`}</Badge>
        </div>
        <p>{OPTIMIZATION_HELP[report.optimizationStatus]}</p>
        <p className="muted">
          Objective: {report.objective === 'least_disruption' ? 'least disruption of the requested design' : 'maximum net value (joint selection)'} · Requested design: {formatDesign(report.requested)} · Review budget: {bundle.economics.reviewCapacityHours} h/month
        </p>
        <CoverageCounts report={report} />
        {report.incompleteReasons.length > 0 ? (
          <div className="results-unknown" role="status">
            <p>
              <strong>Search is incomplete — unknown candidates remain visible and optimality is not claimed:</strong>
            </p>
            <ul>
              {report.incompleteReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {report.best ? null : <p className="results-unknown">No verified candidate is available to apply.</p>}
      </section>

      <section className="results-group" aria-label="Candidates">
        <h4>Candidates</h4>
        <p className="muted">
          The requested design is listed first and stays visible even when ineligible; ineligible designs are never ranked. Candidates are applied to the original design, not cumulatively. Design in the workspace: {formatDesign(design)}.
        </p>
        <div className="results-scroll results-scroll--tall" role="region" aria-label="Candidates scroll area" tabIndex={0}>
          <table className="table candidate-table" aria-label="Repair candidates">
            <thead>
              <tr>
                <th scope="col">Design</th>
                <th scope="col">Automations</th>
                <th scope="col">Controls</th>
                <th scope="col">Verdict</th>
                <th scope="col">Policies</th>
                <th scope="col">Goals</th>
                <th scope="col">Added review hours</th>
                <th scope="col">Net value / month</th>
                <th scope="col">Disruption / month</th>
                <th scope="col">Changed elements</th>
                <th scope="col">Rejection reasons</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {unrepaired ? <CandidateRow c={unrepaired} role="requested" isBest={false} bundle={bundle} onApply={onApply} /> : null}
              {rest.map((c) => (
                <CandidateRow key={c.key} c={c} role="candidate" isBest={report.best?.key === c.key} bundle={bundle} onApply={onApply} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="results-group" aria-label="Economic assumptions used">
        <h4>Economic assumptions used</h4>
        <ul>
          {report.assumptionsUsed.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        <p className="muted">
          Disruption = lost monthly capacity-equivalent benefit + incremental recurring cost + incremental amortized setup. Values are capacity-equivalent value (hours × human-hour value), not guaranteed cash savings. Reachability is a possibility statement and is never a probability.
        </p>
      </section>
    </>
  );
}

export function RepairComparison({ onApply }: { onApply: (design: Design) => void }) {
  const { synthesis, objective } = useAppState();
  const dispatch = useDispatch();
  const reasoner = useReasoner();
  const report = synthesis.status === 'done' ? synthesis.value : null;

  return (
    <div className="results-stack">
      <div className="results-actions">
        <div className="field">
          <label htmlFor="repair-mode">Repair search mode</label>
          <select id="repair-mode" value={objective} onChange={(e) => dispatch({ type: 'setObjective', objective: e.target.value === 'maximum_value' ? 'maximum_value' : 'least_disruption' })}>
            <option value="least_disruption">Least disruption (fixed automations)</option>
            <option value="maximum_value">Maximum net value (joint selection)</option>
          </select>
        </div>
        <button type="button" className="btn btn--primary" disabled={reasoner.busy} onClick={reasoner.runSynthesis}>
          Run synthesis
        </button>
      </div>
      <SlotStatus
        slot={synthesis}
        idle="Run synthesis to search the finite repair catalog (C1–C6). Every candidate is re-verified by the engine; nothing is ranked until the search has run."
        subject="Synthesis"
      />
      {report ? <Results report={report} onApply={onApply} /> : null}
    </div>
  );
}
