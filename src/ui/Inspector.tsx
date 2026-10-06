import { useMemo, type ReactNode } from 'react';
import { authorize, hasExactGrants } from '../engine/capabilities';
import type { CompiledModel } from '../engine/compile';
import type { ActivityContract, AssetSel, EffectExpr, ModelEvent, PredicateExpr, Ref, TupleRef, Witness, WitnessStep } from '../model/types';
import { ENTITY_KIND_DESCRIPTIONS, POLICY_CATALOG, RELATION_KINDS } from '../model/ontology';
import { Badge, usd } from './Badge';
import './graph.css';
import { useAppState } from './state';
import {
  changeReasons,
  describeActivities,
  effectsOf,
  evidenceRequirements,
  resolveSelectedWitness,
  useEffectiveModel,
  type SelectedWitness,
} from './useEffectiveModel';

// ---------- text rendering of model records (always plain text) ----------

const assetSelText = (sel: AssetSel): string => (sel.select === 'latest' ? sel.kind : `${sel.kind}@${sel.select.fact}`);

function refText(ref: Ref): string {
  switch (ref.ref) {
    case 'lit':
      return JSON.stringify(ref.value);
    case 'fact':
      return `fact ${ref.key}`;
    case 'env':
      return `env ${ref.key}`;
    case 'actor':
      return 'actor';
    case 'field':
      return `${assetSelText(ref.asset)}.${ref.name}`;
    case 'version':
      return `version of ${assetSelText(ref.asset)}`;
    case 'factPlus':
      return `fact ${ref.key} + ${ref.add}`;
    case 'policy':
      return `policy ${ref.policyId}.${ref.key}`;
  }
}

const COMPARATOR: Record<'lt' | 'lte' | 'gt' | 'gte', string> = { lt: '<', lte: '≤', gt: '>', gte: '≥' };

function predicateText(expr: PredicateExpr): string {
  switch (expr.op) {
    case 'all':
      return `(${expr.args.map(predicateText).join(' AND ')})`;
    case 'any':
      return `(${expr.args.map(predicateText).join(' OR ')})`;
    case 'not':
      return `NOT ${predicateText(expr.arg)}`;
    case 'equals':
      return `${refText(expr.left)} = ${refText(expr.right)}`;
    case 'compare':
      return `${refText(expr.left)} ${COMPARATOR[expr.cmp]} ${refText(expr.right)}`;
    case 'evidence':
      return `${expr.name}(${expr.target})`;
    case 'exists':
      return `exists ${assetSelText(expr.asset)}`;
  }
}

const tupleText = (t: TupleRef): string => `${t.kind} ${t.objectId} v${t.version}${t.detail ? ` (${t.detail})` : ''}`;

function eventText(ev: ModelEvent): string {
  switch (ev.kind) {
    case 'action':
      return `${ev.activityId}: ${ev.actorId} ${ev.operation} ${ev.resource}${ev.fields.length > 0 ? ` [${ev.fields.join(', ')}]` : ''} for ${ev.purpose}`;
    case 'transfer':
      return `${ev.activityId}: transfer of ${ev.fields.map((f) => f.name).join(', ') || 'no fields'} to ${ev.to} (${ev.boundary}) for ${ev.purpose}${ev.droppedByControl.length > 0 ? `; projected away by control: ${ev.droppedByControl.join(', ')}` : ''}`;
    case 'evidenceIssued':
      return `${ev.activityId}: ${ev.evidence.kind} evidence issued by ${ev.evidence.issuer} for ${Object.entries(ev.evidence.subject)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ')}; valid ${ev.evidence.validFrom} to ${ev.evidence.validUntil}${ev.evidence.escalation ? '; escalation admitted' : ''}`;
    case 'paymentExecuted':
      return `${ev.activityId}: payment ${ev.payload.paymentId} v${ev.payload.paymentVersion} executed${ev.retry ? ' (retry)' : ''}: ${usd(ev.payload.amountCents / 100)} ${ev.payload.currency} to supplier ${ev.payload.supplierId} bank v${ev.payload.bankVersion} (${ev.payload.accountDigest}); obligation ${ev.obligationId}; settlements after: ${ev.settlementsAfter}`;
    case 'receiptReplayed':
      return `${ev.activityId}: prior receipt returned for obligation ${ev.obligationId} (idempotency key ${ev.idempotencyKey}); no new settlement`;
    case 'controlDecision':
      return `${ev.activityId}: control ${ev.controlId} decided ${ev.decision}: ${ev.reason}`;
    case 'disposition':
      return `${ev.activityId}: disposition ${ev.disposition}: ${ev.reason}`;
  }
}

// ---------- layout primitives ----------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="inspector__section">
      <h3 className="inspector__heading">{title}</h3>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="inspector__rows">
      {rows.map(([label, value]) => (
        <div key={label} className="inspector__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function List({ items, empty }: { items: ReactNode[]; empty?: string }) {
  if (items.length === 0) return empty ? <p className="muted">{empty}</p> : null;
  return (
    <ul className="inspector__list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

const nameOf = (model: CompiledModel, id: string): string => {
  const entity = model.bundle.entities.find((e) => e.id === id);
  return entity && 'name' in entity ? entity.name : id;
};

// ---------- source metadata ----------

function SourceMetadata({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Section title="Source metadata">
      <Rows rows={rows} />
    </Section>
  );
}

// ---------- activity ----------

function ActivityDetails({ id, effective, baseline }: { id: string; effective: CompiledModel; baseline: CompiledModel | null }) {
  const view = describeActivities(baseline, effective).find((v) => v.id === id);
  const entity = effective.bundle.entities.find((e) => e.kind === 'Activity' && e.id === id);
  const inEffective = effective.contractById.get(id);
  const contract = inEffective ?? baseline?.contractById.get(id);
  if (!view || !entity || entity.kind !== 'Activity') return <p className="muted">{`Activity ${id} is not part of this model.`}</p>;
  const bundle = effective.bundle;
  const actor = contract ? effective.principals.get(contract.actorId) : undefined;
  const roleName = (roleId: string): string => nameOf(effective, roleId);
  const provenance = effective.effective.provenance.filter((p) => p.summary.split(/[\s;]+/).includes(id));
  const baselineContract = baseline?.contractById.get(id);

  return (
    <>
      <p className="inspector__lead">
        <strong>{id}</strong> {entity.name}
      </p>
      {view.status !== 'present' && (
        <p className="inspector__notice" role="note">
          <span aria-hidden="true">⊘ </span>
          {view.status === 'removed'
            ? `Removed by ${view.removedBy.join(', ')}: this contract is not part of the effective design${contract ? '; the manual baseline contract is shown for reference.' : '.'}`
            : 'No contract exists for this activity in the current model.'}
        </p>
      )}
      <SourceMetadata
        rows={[
          ['Id', id],
          ['Kind', 'Activity'],
          ['sourceRef', entity.sourceRef],
          ['evidenceStatus', entity.evidenceStatus],
          ['Lane', entity.lane === 'supplier' ? 'Supplier management' : 'Invoice-to-payment'],
          ['Accountable org unit', nameOf(effective, entity.ownerOrgUnitId)],
          ['Conditional', entity.conditional ? 'Yes' : 'No'],
          ['Summary', entity.summary],
          ...(contract ? ([['Contract sourceRef', contract.sourceRef], ['Contract evidenceStatus', contract.evidenceStatus]] as [string, ReactNode][]) : []),
        ]}
      />
      {contract && (
        <>
          <Section title="Actor and operation">
            <Rows
              rows={[
                ['Actor', actor ? actor.name : contract.actorId],
                ['Principal kind', actor?.principalKind ?? 'unknown'],
                ['Effective identity', actor?.effectiveIdentityId ?? 'unknown'],
                ['Independence group', actor?.independenceGroup ?? 'unknown'],
                ['Roles', actor && actor.roleIds.length > 0 ? actor.roleIds.map(roleName).join(', ') : 'none'],
                ['Operation', contract.operation],
                ['Inputs', contract.inputs.length > 0 ? contract.inputs.map((i) => `${assetSelText(i.asset)} (${i.role})`).join(', ') : 'none'],
                ['Preconditions', <code key="pre" className="inspector__code">{predicateText(contract.workflowPreconditions)}</code>],
              ]}
            />
            <TransferDetails contract={contract} model={effective} />
          </Section>
          <TechnicalAbility contract={contract} model={effective} />
          <NormativeRule contract={contract} model={effective} />
          <ImplementedGuard contract={contract} model={effective} />
          <EvidenceDetails contract={contract} model={effective} />
        </>
      )}
      <Section title="Patch provenance">
        <p className="muted">Changed vs manual baseline</p>
        <List
          items={changeReasons(baselineContract, inEffective)}
          empty={baseline ? 'No difference from the manual baseline contract.' : 'No manual baseline is available.'}
        />
        <p className="muted">Patches that touched this activity</p>
        <List
          items={provenance.map((p) => (
            <span key={`${p.stage}-${p.source}`}>
              <strong>{p.source}</strong> ({p.stage}, {p.changed ? 'changed' : 'no change'}): {p.summary}
            </span>
          ))}
          empty="No automation, control or variant patch mentions this activity."
        />
      </Section>
      {bundle.completeness.controlImplementation === 'unknown' && <p className="inspector__notice">Control implementation completeness is declared unknown for this model.</p>}
    </>
  );
}

function TransferDetails({ contract, model }: { contract: ActivityContract; model: CompiledModel }) {
  const transfers = effectsOf(contract).flatMap((f) => (f.op === 'recordTransfer' ? [f] : []));
  if (transfers.length === 0) return null;
  return (
    <>
      <p className="muted">Data transfers (payload fields with purpose)</p>
      <List
        items={transfers.map((t) => {
          const system = model.systems.get(t.to);
          return (
            <span key={`${t.to}-${t.purpose}-${t.fields.length}`}>
              <strong>{system ? system.name : t.to}</strong> ({system ? system.boundary : 'unknown boundary'}) for <em>{t.purpose}</em>: {t.fields.map((f) => `${assetSelText(f.asset)}.${f.name}`).join(', ')}
            </span>
          );
        })}
      />
    </>
  );
}

function TechnicalAbility({ contract, model }: { contract: ActivityContract; model: CompiledModel }) {
  const grants = model.bundle.capabilities;
  return (
    <Section title="Technical ability">
      <p className="muted">
        Exact grants this actor needs versus the grants present in the capability inventory (inventory: {model.bundle.completeness.capabilityInventory}). Roles and departments confer nothing.
      </p>
      <List
        items={contract.capabilityRequirements.map((req) => {
          const present = hasExactGrants(model, contract.actorId, [req]);
          const grant = grants.find((g) => g.principalId === contract.actorId && g.system === req.system && g.operation === req.operation && g.resource === req.resource);
          return (
            <span key={`${req.system}-${req.operation}-${req.resource}`}>
              <Badge tone={present ? 'ok' : 'bad'}>{present ? 'Present' : 'Absent'}</Badge> {contract.actorId} may {req.operation} {req.resource} on {req.system}
              {grant ? ` (grant ${grant.id})` : ''}
            </span>
          );
        })}
        empty="This activity requires no technical capability."
      />
    </Section>
  );
}

function NormativeRule({ contract, model }: { contract: ActivityContract; model: CompiledModel }) {
  const seen = new Set<string>();
  const actions = effectsOf(contract).flatMap((f) => {
    if (f.op !== 'recordAction') return [];
    const key = `${f.operation}|${f.resource}|${f.fields.join(',')}|${f.purpose}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [f];
  });
  return (
    <Section title="Normative rule">
      <p className="muted">Company authorization table for each sensitive action of this activity. Deny overrides allow; no matching allow means prohibited.</p>
      <List
        items={actions.map((a) => {
          const decision = authorize(model, { kind: 'action', activityId: contract.id, actorId: contract.actorId, operation: a.operation, resource: a.resource, fields: a.fields, purpose: a.purpose });
          return (
            <span key={`${a.operation}-${a.resource}-${a.purpose}-${a.fields.join(',')}`}>
              <Badge tone={decision.allowed ? 'ok' : 'bad'}>{decision.allowed ? 'Allowed' : 'Prohibited'}</Badge> {a.operation} {a.resource}
              {a.fields.length > 0 ? ` [${a.fields.join(', ')}]` : ''} for {a.purpose}: {decision.reason}
            </span>
          );
        })}
        empty="This activity records no sensitive action."
      />
    </Section>
  );
}

function ImplementedGuard({ contract, model }: { contract: ActivityContract; model: CompiledModel }) {
  return (
    <Section title="Implemented guard">
      <p className="muted">A missing policy predicate stays observable at execution; only an implemented control can block a transition.</p>
      <List
        items={contract.implementedControlIds.map((controlId) => {
          const control = model.controls.get(controlId);
          if (!control) return <span key={controlId}>{controlId}: control record not found</span>;
          const tone = control.implemented === true ? 'ok' : control.implemented === false ? 'bad' : 'warn';
          return (
            <span key={controlId}>
              <strong>{control.id}</strong> {control.name} ({control.mode}) <Badge tone={tone}>{control.implemented === 'unknown' ? 'Implementation unknown' : control.implemented ? 'Implemented' : 'Not implemented'}</Badge>
              <br />
              {control.description}
              {control.guard && (
                <>
                  <br />
                  <code className="inspector__code">{predicateText(control.guard)}</code>
                </>
              )}
            </span>
          );
        })}
        empty="No control is implemented on this activity."
      />
    </Section>
  );
}

function EvidenceDetails({ contract, model }: { contract: ActivityContract; model: CompiledModel }) {
  const bundle = model.bundle;
  const issued = new Map<string, Extract<EffectExpr, { op: 'issueEvidence' }>>();
  for (const f of effectsOf(contract)) if (f.op === 'issueEvidence') issued.set(`${f.kind}|${f.subject}`, f);
  const required = evidenceRequirements(model, contract);
  const kinds = [...new Set([...[...issued.values()].map((f) => f.kind), ...required.map((r) => r.kind)])];
  const param = (id: string, key: string): string => {
    const v = bundle.policies.find((p) => p.id === id)?.params[key];
    return v === undefined ? 'not declared' : Array.isArray(v) ? v.join(', ') : String(v);
  };
  const kindPolicy: Record<string, [string, string][]> = {
    beneficiaryVerification: [
      ['P01 verifier roles', param('P01', 'verifierRoleIds')],
      ['P01 admitted methods', param('P01', 'admittedMethods')],
      ['P01 trusted sources', param('P01', 'trustedSources')],
    ],
    paymentAuthorization: [
      ['P02 approver roles', param('P02', 'approverRoleIds')],
      ['P05 amount limit (cents)', param('P05', 'limitCents')],
    ],
    onboardingClearance: [['P05 clearance roles', param('P05', 'clearanceRoleIds')]],
  };
  return (
    <Section title="Evidence">
      <List
        items={[...issued.values()].map((f) => (
          <span key={`${f.kind}-${f.subject}`}>
            Issues <strong>{f.kind}</strong> for the {f.subject}; method {refText(f.method)}; sources {f.sources.length > 0 ? f.sources.map(refText).join(', ') : 'none'}; valid {f.validDays} days
            {f.escalation ? `; escalation ${refText(f.escalation)}` : ''}
          </span>
        ))}
        empty="This activity issues no evidence."
      />
      <List
        items={required.map((r) => (
          <span key={`${r.predicate}-${r.via ?? 'own'}`}>
            Requires <strong>{r.kind}</strong> ({r.predicate}) {r.via ? `through control ${r.via}` : 'in its own preconditions'}
          </span>
        ))}
        empty="No implemented predicate or control requires evidence here."
      />
      {kinds.map((kind) => {
        const record = bundle.entities.find((e) => e.kind === 'Evidence' && e.evidenceKind === kind);
        return (
          <div key={kind} className="inspector__subsection">
            <p className="muted">{kind}</p>
            <Rows
              rows={[
                ['Tuple fields', record && record.kind === 'Evidence' ? record.subjectFields.join(', ') : 'no evidence record'],
                ['Description', record && record.kind === 'Evidence' ? record.description : 'none'],
                ['Independence', kind === 'paymentAuthorization' ? 'issuer independent of the payment preparer (effective identity and independence group)' : kind === 'beneficiaryVerification' ? 'verifier independent of the maintenance editor and from a trusted independent source' : 'issued by an authorized clearance role'],
                ...(kindPolicy[kind] ?? []).map(([k, v]): [string, ReactNode] => [k, v]),
              ]}
            />
          </div>
        );
      })}
    </Section>
  );
}

// ---------- witness (finding / step) ----------

function StepDetails({ step, effective }: { step: WitnessStep; effective: CompiledModel }) {
  return (
    <Section title={`Step ${step.index + 1}: ${step.activityId}`}>
      <Rows
        rows={[
          ['Activity', `${step.activityId} ${nameOf(effective, step.activityId)}`],
          ['Branch', step.branchId],
          ['Actor', `${nameOf(effective, step.actorId)} (${step.actorId})`],
          ['Summary', step.summary],
          ['State key hash after', <code key="h">{step.stateKeyHashAfter}</code>],
        ]}
      />
      <p className="muted">Consumed tuples</p>
      <List items={step.consumed.map(tupleText)} empty="Nothing consumed." />
      <p className="muted">Produced tuples</p>
      <List items={step.produced.map(tupleText)} empty="Nothing produced." />
      <p className="muted">Events</p>
      <List items={step.events.map(eventText)} empty="No events." />
    </Section>
  );
}

function ReplayResult({ witness }: { witness: Witness }) {
  const replay = useAppState().replay;
  if (!replay || replay.witnessId !== witness.id) return null;
  return (
    <Section title="Replay result">
      {replay.status === 'running' && <p role="status">Replaying the witness against the engine…</p>}
      {replay.status === 'failed' && <p role="alert">{`Replay failed: ${replay.message ?? 'unknown error'}`}</p>}
      {replay.status === 'done' && replay.result && (
        <>
          <p>
            <Badge tone={replay.result.status === 'verified' ? 'info' : 'bad'}>{replay.result.status === 'verified' ? 'Replay verified' : 'Replay rejected'}</Badge>{' '}
            {replay.result.verifiedSteps} of {witness.steps.length} steps verified
            {replay.result.failingStepIndex !== null ? `; failing step ${replay.result.failingStepIndex + 1}` : ''}
          </p>
          <List items={replay.result.reasons} />
          {replay.result.violation && <p>{`Confirmed violation: ${replay.result.violation.policyId} — ${replay.result.violation.message}`}</p>}
        </>
      )}
    </Section>
  );
}

function WitnessDetails({ selected, effective, baseline }: { selected: SelectedWitness; effective: CompiledModel; baseline: CompiledModel | null }) {
  const { witness, finding, goalFailure } = selected;
  const focus = witness.steps[selected.focusIndex];
  const policy = finding ? POLICY_CATALOG[finding.policyId] : null;
  return (
    <>
      <p className="inspector__lead">
        <strong>{finding ? `${finding.policyId} violation` : 'Business-goal failure'}</strong> in case {witness.caseId}
      </p>
      <SourceMetadata
        rows={[
          ['Id', selected.id],
          ['Kind', finding ? 'Finding' : 'Goal failure'],
          ['Case', witness.caseId],
          ['Mechanism', finding ? finding.mechanism : (goalFailure?.kind ?? 'unknown')],
          ['Witness', witness.id],
          ['Steps', `${witness.steps.length}; violation observed at step ${witness.violation.stepIndex + 1}`],
        ]}
      />
      <Section title="What fails">
        <p>{finding ? finding.message : (goalFailure?.message ?? witness.violation.message)}</p>
        {policy && (
          <Rows
            rows={[
              [`${finding?.policyId ?? ''} ${policy.title}`, policy.requirement],
              ['Checked at', policy.checkedAt],
            ]}
          />
        )}
        {goalFailure && <Rows rows={[['Actual outcome', goalFailure.actual]]} />}
        <p className="muted">Evidence-failure reasons</p>
        <List items={witness.violation.reasons} empty="The engine recorded no further reasons." />
      </Section>
      {finding && (
        <Section title="Retained safeguards and enabling patches">
          <p className="muted">Safeguards that remain in place</p>
          <List items={finding.retainedSafeguards} empty="None recorded." />
          <p className="muted">Patches that enable the violation</p>
          <List items={finding.enablingPatches} empty="No patch is required: the violation exists in the baseline model." />
        </Section>
      )}
      {focus && <StepDetails step={focus} effective={effective} />}
      <ReplayResult witness={witness} />
      {focus && (
        <details className="inspector__details">
          <summary>{`Activity at step ${focus.index + 1}: ${focus.activityId}`}</summary>
          <ActivityDetails id={focus.activityId} effective={effective} baseline={baseline} />
        </details>
      )}
    </>
  );
}

// ---------- other entities ----------

function ControlDetails({ id, model }: { id: string; model: CompiledModel }) {
  const control = model.controls.get(id);
  if (!control) return <p className="muted">{`Control ${id} is not part of this model.`}</p>;
  const guarded = model.contracts.filter((c) => c.implementedControlIds.includes(id)).map((c) => c.id);
  return (
    <>
      <p className="inspector__lead">
        <strong>{control.id}</strong> {control.name}
      </p>
      <SourceMetadata rows={[['Id', control.id], ['Kind', 'Control'], ['sourceRef', control.sourceRef], ['evidenceStatus', control.evidenceStatus]]} />
      <Section title="Implemented guard">
        <p className="muted">A missing policy predicate stays observable at execution; only an implemented control can block a transition.</p>
        <Rows
          rows={[
            ['Mode', control.mode],
            ['Implemented', String(control.implemented)],
            ['Description', control.description],
            ['Guard', control.guard ? <code key="g" className="inspector__code">{predicateText(control.guard)}</code> : 'none'],
            ['Guards activities', guarded.length > 0 ? guarded.join(', ') : 'none in the effective design'],
          ]}
        />
      </Section>
    </>
  );
}

function PrincipalDetails({ id, model }: { id: string; model: CompiledModel }) {
  const principal = model.principals.get(id);
  if (!principal) return <p className="muted">{`Principal ${id} is not part of this model.`}</p>;
  const grants = model.bundle.capabilities.filter((g) => g.principalId === id);
  return (
    <>
      <p className="inspector__lead">
        <strong>{principal.id}</strong> {principal.name}
      </p>
      <SourceMetadata rows={[['Id', principal.id], ['Kind', 'Principal'], ['sourceRef', principal.sourceRef], ['evidenceStatus', principal.evidenceStatus]]} />
      <Section title="Actor">
        <Rows
          rows={[
            ['Principal kind', principal.principalKind],
            ['Effective identity', principal.effectiveIdentityId],
            ['Independence group', principal.independenceGroup],
            ['Roles', principal.roleIds.map((r) => nameOf(model, r)).join(', ') || 'none'],
          ]}
        />
      </Section>
      <Section title="Technical ability">
        <List items={grants.map((g) => `${g.operation} ${g.resource} on ${g.system} (grant ${g.id})`)} empty="No capability grants." />
      </Section>
    </>
  );
}

function SystemDetails({ id, model }: { id: string; model: CompiledModel }) {
  const system = model.systems.get(id);
  if (!system) return <p className="muted">{`System ${id} is not part of this model.`}</p>;
  return (
    <>
      <p className="inspector__lead">
        <strong>{system.id}</strong> {system.name}
      </p>
      <SourceMetadata rows={[['Id', system.id], ['Kind', 'System'], ['sourceRef', system.sourceRef], ['evidenceStatus', system.evidenceStatus]]} />
      <Section title="Boundary and permitted use">
        <Rows
          rows={[
            ['Boundary', system.boundary],
            ['Approved purposes', system.approvedPurposes.join(', ') || 'none'],
            ['Accepted categories', system.acceptedCategories.join(', ') || 'none'],
            ['Approved fields', system.approvedFields ? system.approvedFields.join(', ') : 'not restricted by field list'],
          ]}
        />
      </Section>
    </>
  );
}

// ---------- catalog ----------

function Catalog() {
  return (
    <details className="inspector__details inspector__catalog">
      <summary>Ontology &amp; policy catalog</summary>
      <Section title="Entity kinds">
        <dl className="inspector__rows">
          {Object.entries(ENTITY_KIND_DESCRIPTIONS).map(([kind, d]) => (
            <div key={kind} className="inspector__row">
              <dt>{kind}</dt>
              <dd>
                {d.meaning}. Identified by: {d.identifying}.
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Relation vocabulary">
        <dl className="inspector__rows">
          {RELATION_KINDS.map((r) => (
            <div key={r.id} className="inspector__row">
              <dt>{r.id}</dt>
              <dd>
                {r.direction}. Must not infer: {r.mustNotInfer}.
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Policies">
        <dl className="inspector__rows">
          {Object.entries(POLICY_CATALOG).map(([id, p]) => (
            <div key={id} className="inspector__row">
              <dt>{`${id} ${p.title}`}</dt>
              <dd>
                {p.requirement} Checked at: {p.checkedAt}.
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </details>
  );
}

// ---------- root ----------

export function Inspector() {
  const state = useAppState();
  const { baseline, effective, error } = useEffectiveModel();
  const selectedWitness = useMemo(() => resolveSelectedWitness(state.selection, state.analysis), [state.selection, state.analysis]);
  const selection = state.selection;

  let body: ReactNode;
  if (!effective) body = <p className="muted" role="alert">{`The selected inputs do not compile into a model: ${error ?? 'unknown error'}`}</p>;
  else if (!selection)
    body = (
      <p className="muted">
        Nothing is selected. Select an activity node in the graph, or a finding or witness step in the Findings tab, to see its source metadata, technical ability, normative rule, implemented guard,
        evidence and patch provenance.
      </p>
    );
  else if (selection.type === 'activity') body = <ActivityDetails id={selection.id} effective={effective} baseline={baseline} />;
  else if (selection.type === 'control') body = <ControlDetails id={selection.id} model={effective} />;
  else if (selection.type === 'principal') body = <PrincipalDetails id={selection.id} model={effective} />;
  else if (selection.type === 'system') body = <SystemDetails id={selection.id} model={effective} />;
  else if (selectedWitness) body = <WitnessDetails selected={selectedWitness} effective={effective} baseline={baseline} />;
  else
    body = (
      <p className="muted" role="note">
        The selected finding has no witness in the current analysis. Run Analyze again to inspect it.
      </p>
    );

  return (
    <aside className="inspector" aria-label="Inspector">
      <h2 className="inspector__title">Inspector</h2>
      {body}
      <Catalog />
    </aside>
  );
}
