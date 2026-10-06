import { useMemo } from 'react';
import { reportToMarkdown } from '../engine/report';
import { FINITE_SCOPE_STATEMENT } from '../model/ontology';
import type { CaseRecord, RequiredOutcome } from '../model/types';
import { Badge, type Tone } from './Badge';
import { useCurrentEnvelope } from './exportReport';
import { useAppState } from './state';

const EVIDENCE_TONE: Record<string, Tone> = { fixture: 'neutral', observed: 'ok', assumed: 'warn', unknown: 'warn' };

const outcomeText = (o: RequiredOutcome): string => (o.kind === 'held' ? `held: ${o.reason}` : o.kind.replace(/_/g, ' '));

function branchText(c: CaseRecord): string {
  const entries = Object.entries(c.branchDomains);
  return entries.length === 0 ? 'none' : entries.map(([k, v]) => `${k}: ${v.join(' | ')}`).join('; ');
}

function CaseTable() {
  const { bundle, caseIds, suiteId } = useAppState();
  const suite = bundle.suites.find((s) => s.id === suiteId);
  const cases = caseIds.flatMap((id) => bundle.cases.filter((c) => c.id === id));
  const exceptionCases = cases.filter((c) => !c.legitimate);
  return (
    <section className="results-group" aria-label="Case partition">
      <h4>Case partition and required outcomes</h4>
      <p className="muted">
        Active suite: <strong>{suite?.label ?? suiteId}</strong>. Legitimate cases must end in their required outcome on every terminal execution. Cases marked not legitimate are declared exception cases with their own required outcome.
        {exceptionCases.length > 0 ? ` Declared exception case(s): ${exceptionCases.map((c) => c.id).join(', ')}.` : ''} The legitimate cases' finite extraction domains contain only correct extraction; incorrect extraction is explored only inside the declared exception case. This is an assurance assumption, not a claim that extraction is infallible outside the model.
      </p>
      <div className="results-scroll" role="region" aria-label="Case table scroll area" tabIndex={0}>
        <table className="table" aria-label="Active cases">
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Legitimate</th>
              <th scope="col">Required outcome</th>
              <th scope="col">Branch domains</th>
              <th scope="col">Requires automations</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  {c.label}
                  <div className="muted">{c.id}</div>
                </th>
                <td>{c.legitimate ? 'Yes' : 'No — exception case'}</td>
                <td>{outcomeText(c.requiredOutcome)}</td>
                <td>{branchText(c)}</td>
                <td>{c.requiresAutomations.length > 0 ? c.requiresAutomations.join(', ') : 'none'}</td>
                <td>{c.sourceRef}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModelAssumptions() {
  const { bundle } = useAppState();
  return (
    <section className="results-group" aria-label="Model assumptions">
      <h4>
        Model assumptions <span className="muted">({bundle.assumptions.length})</span>
      </h4>
      <div className="results-scroll" role="region" aria-label="Model assumptions scroll area" tabIndex={0}>
        <table className="table" aria-label="Model assumption list">
          <thead>
            <tr>
              <th scope="col">Id</th>
              <th scope="col">Category</th>
              <th scope="col">Evidence status</th>
              <th scope="col">Assumption</th>
            </tr>
          </thead>
          <tbody>
            {bundle.assumptions.map((a) => (
              <tr key={a.id}>
                <th scope="row">{a.id}</th>
                <td>{a.category}</td>
                <td>
                  <Badge tone={EVIDENCE_TONE[a.evidenceStatus] ?? 'neutral'}>{a.evidenceStatus}</Badge>
                </td>
                <td>{a.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Reproducibility() {
  const { analysis } = useAppState();
  if (analysis.status !== 'done') {
    return (
      <section className="results-group" aria-label="Engine assumptions and hashes">
        <h4>Engine assumptions and reproducibility</h4>
        <p className="results-empty">Run Analyze to list the assumptions the engine applied and the model, design and policy hashes.</p>
      </section>
    );
  }
  const r = analysis.value;
  const h = analysis.hashes;
  const rows: [string, string][] = [
    ['Hash algorithm', h.algorithm],
    ['Model hash', h.modelHash],
    ['Design hash', h.designHash],
    ['Policy hash', h.policyHash],
    ['Engine version', r.engineVersion],
    ['Schema version', r.schemaVersion],
    ['Graph version', r.graphVersion],
    ['Policy version', r.policyVersion],
    ['Fixed analysis date', r.analysisDate],
    ['Observed analysis duration (runtime metadata only)', `${Math.round(analysis.durationMs)} ms`],
  ];
  return (
    <>
      <section className="results-group" aria-label="Engine assumptions">
        <h4>Assumptions applied by the engine</h4>
        {r.assumptions.length === 0 ? (
          <p className="muted">The engine reported no additional assumptions.</p>
        ) : (
          <ul>
            {r.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="results-group" aria-label="Reproducibility identifiers">
        <h4>Reproducibility identifiers</h4>
        <p className="muted">Hashes identify the canonical inputs for reproduction. They are not certification.</p>
        <dl className="repro-list">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                <code>{v}</code>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

function ReportPreview() {
  const env = useCurrentEnvelope();
  const markdown = useMemo(() => (env ? reportToMarkdown(env) : null), [env]);
  return (
    <section className="results-group" aria-label="Report preview">
      <h4>Report preview (Markdown, shown as text)</h4>
      {markdown === null ? (
        <p className="results-empty">Run Analyze to enable the report preview.</p>
      ) : (
        <pre className="report-preview" tabIndex={0} aria-label="Report Markdown preview">
          {markdown}
        </pre>
      )}
    </section>
  );
}

export function AssumptionsPanel() {
  return (
    <div className="results-stack">
      <section className="results-group" aria-label="Finite-scope assurance statement">
        <h4>Finite-scope assurance statement</h4>
        <p>{FINITE_SCOPE_STATEMENT}</p>
      </section>
      <CaseTable />
      <ModelAssumptions />
      <Reproducibility />
      <ReportPreview />
    </div>
  );
}
