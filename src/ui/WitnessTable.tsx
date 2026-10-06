import { Badge } from './Badge';
import { useAppState, useDispatch } from './state';
import type { ModelEvent, TupleRef, Witness } from '../model/types';

const cents = (n: number): string => (n / 100).toFixed(2);

function describeEvent(e: ModelEvent): string {
  switch (e.kind) {
    case 'action':
      return `action ${e.operation} on ${e.resource} by ${e.actorId} [${e.fields.join(', ') || 'no fields'}], purpose ${e.purpose}`;
    case 'transfer': {
      const fields = e.fields.map((f) => `${f.name} (${f.categories.join('/') || 'uncategorised'})`).join(', ') || 'no fields';
      const dropped = e.droppedByControl.length > 0 ? `; dropped by control: ${e.droppedByControl.join(', ')}` : '';
      return `transfer to ${e.to} (${e.boundary}), purpose ${e.purpose}: ${fields}${dropped}`;
    }
    case 'evidenceIssued': {
      const who = [e.preparerId ? `preparer ${e.preparerId}` : null, e.editorId ? `editor ${e.editorId}` : null].filter((x) => x !== null).join(', ');
      return `evidence issued: ${e.evidence.kind} ${e.evidence.id} by ${e.evidence.issuer} via ${e.evidence.method}${who ? ` (${who})` : ''}`;
    }
    case 'paymentExecuted': {
      const p = e.payload;
      return `payment executed${e.retry ? ' (retry)' : ''}: payment ${p.paymentId}@v${p.paymentVersion}, invoice ${p.invoiceId}@v${p.invoiceVersion}, supplier ${p.supplierId} bank v${p.bankVersion} digest ${p.accountDigest}, ${cents(p.amountCents)} ${p.currency}, preparer ${p.preparerId}; obligation ${e.obligationId}, key ${e.idempotencyKey}, settlements now ${e.settlementsAfter}`;
    }
    case 'receiptReplayed':
      return `receipt replayed for obligation ${e.obligationId} (key ${e.idempotencyKey}); no second settlement`;
    case 'controlDecision':
      return `control ${e.controlId}: ${e.decision} — ${e.reason}`;
    case 'disposition':
      return `disposition ${e.disposition}: ${e.reason}`;
  }
}

function Tuples({ items }: { items: TupleRef[] }) {
  if (items.length === 0) return <span className="muted">none</span>;
  return (
    <ul className="witness-list">
      {items.map((t, i) => (
        <li key={`${t.kind}:${t.objectId}:${t.version}:${i}`}>
          <code>{`${t.kind}@v${t.version}`}</code> {t.objectId}
          {t.detail ? <span className="muted"> — {t.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Ordered, keyboard-accessible witness path. One real button per step selects the step (and the matching canvas activity). */
export function WitnessTable({ witness, findingId }: { witness: Witness; findingId: string }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const sel = state.selection;
  const selectedIndex = sel?.type === 'step' && sel.findingId === findingId ? sel.index : null;
  const { violation } = witness;

  return (
    <div className="witness">
      <div className="results-scroll" role="region" aria-label="Witness path" tabIndex={0}>
        <table className="table witness-table" aria-label="Witness steps">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Activity / transition</th>
              <th scope="col">Actor</th>
              <th scope="col">Consumed</th>
              <th scope="col">Produced</th>
              <th scope="col">Events and control decisions</th>
              <th scope="col">State hash</th>
            </tr>
          </thead>
          <tbody>
            {witness.steps.map((step) => {
              const n = step.index + 1;
              const isViolation = step.index === violation.stepIndex;
              return (
                <tr key={step.index} aria-current={selectedIndex === step.index ? 'step' : undefined} className={selectedIndex === step.index ? 'is-selected' : undefined}>
                  <th scope="row">
                    <button
                      type="button"
                      className="btn btn--ghost witness-step-btn"
                      aria-label={`Select step ${n}: ${step.transitionId}`}
                      onClick={() => dispatch({ type: 'select', selection: { type: 'step', findingId, index: step.index } })}
                    >
                      {n}
                    </button>
                    {isViolation ? <Badge tone="bad">Violation</Badge> : null}
                  </th>
                  <td>
                    <strong>{step.activityId}</strong>
                    <div className="muted">
                      {step.transitionId} (branch {step.branchId})
                    </div>
                    <div>{step.summary}</div>
                  </td>
                  <td>{step.actorId}</td>
                  <td>
                    <Tuples items={step.consumed} />
                  </td>
                  <td>
                    <Tuples items={step.produced} />
                  </td>
                  <td>
                    {step.events.length === 0 ? (
                      <span className="muted">no events</span>
                    ) : (
                      <ul className="witness-list">
                        {step.events.map((e, i) => (
                          <li key={i}>
                            {describeEvent(e)}
                            {isViolation && i === violation.eventIndex ? <strong> ← {violation.policyId} violating event</strong> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <code title={step.stateKeyHashAfter}>{step.stateKeyHashAfter.slice(0, 8)}</code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="witness-violation">
        <p>
          <strong>Violation ({violation.policyId}, step {violation.stepIndex + 1}):</strong> {violation.message}
        </p>
        {violation.reasons.length > 0 ? (
          <>
            <p className="witness-violation__heading">Evidence failure reasons</p>
            <ul>
              {violation.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
