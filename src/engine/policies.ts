import type { CaseRecord, ExecutionState, ModelEvent, PaymentPayload, PolicyId } from '../model/types';
import { authorize } from './capabilities';
import type { CompiledModel } from './compile';
import { beneficiaryTuple, explainApproval, explainBeneficiary, explainClearance, independent, policyNumber } from './evidence';
import { fieldViolation, type Transition } from './transitions';

export interface Violation {
  policyId: PolicyId;
  mechanism: string;
  message: string;
  reasons: string[];
  eventIndex: number;
}

export interface MonitorInput {
  model: CompiledModel;
  c: CaseRecord;
  pre: ExecutionState;
  post: ExecutionState;
  transition: Transition;
  events: ModelEvent[];
}

export const hazardId = (policyId: string, mechanism: string, caseId: string) => `${policyId}|${mechanism}|${caseId}`;

function editorOf(state: ExecutionState, version: number): string | null {
  const e = state.assets[`supplierMaster:${version}`]?.fields.editor?.value;
  return typeof e === 'string' && e ? e : null;
}

function matchResult(state: ExecutionState, invoiceVersion: number): string {
  const a = state.assets[`orderReceiptMatch:${invoiceVersion}`];
  const r = a?.fields.result?.value;
  return typeof r === 'string' ? r : 'absent';
}

function checkPayment(m: MonitorInput, p: PaymentPayload, idx: number, ev: Extract<ModelEvent, { kind: 'paymentExecuted' }>): Violation[] {
  const { model, c, pre } = m;
  const out: Violation[] = [];
  const ben = explainBeneficiary(model, pre, c.id, beneficiaryTuple(p), editorOf(pre, p.bankVersion));
  if (!ben.valid)
    out.push({
      policyId: 'P01',
      mechanism: 'unverified-destination',
      message: `${ev.activityId} executed a payment to (${p.supplierId}, v${p.bankVersion}, ${p.accountDigest}) with no valid independent beneficiary verification`,
      reasons: ben.reasons,
      eventIndex: idx,
    });
  const apr = explainApproval(model, pre, c.id, p);
  if (!apr.valid)
    out.push({
      policyId: 'P02',
      mechanism: 'unbound-or-dependent-approval',
      message: `${ev.activityId} executed a payment whose exact fingerprint is not covered by a valid independent approval`,
      reasons: apr.reasons,
      eventIndex: idx,
    });
  const clr = explainClearance(model, pre, c.id, p.supplierId);
  if (!clr.valid)
    out.push({ policyId: 'P05', mechanism: 'missing-clearance', message: `Payment executed without onboarding clearance for ${p.supplierId}`, reasons: clr.reasons, eventIndex: idx });
  const match = matchResult(pre, p.invoiceVersion);
  if (match !== 'match')
    out.push({
      policyId: 'P05',
      mechanism: 'unmatched-invoice',
      message: `Payment executed although invoice ${p.invoiceId} v${p.invoiceVersion} has match result '${match}'`,
      reasons: [`orderReceiptMatch for exact invoice version ${p.invoiceVersion} is '${match}'`],
      eventIndex: idx,
    });
  const limit = policyNumber(model, 'P05', 'limitCents');
  if (p.amountCents > limit) {
    const escalated = apr.valid && pre.evidence.find((e) => e.id === apr.evidenceId)?.escalation === true;
    if (!escalated)
      out.push({
        policyId: 'P05',
        mechanism: 'limit-exceeded-without-escalation',
        message: `Payment of ${p.amountCents} cents exceeds the ${limit}-cent routine limit without escalation approval`,
        reasons: [`no escalated paymentAuthorization for amount ${p.amountCents}`],
        eventIndex: idx,
      });
  }
  if (ev.settlementsAfter > 1)
    out.push({
      policyId: 'P06',
      mechanism: 'second-settlement',
      message: `Obligation ${ev.obligationId} was settled ${ev.settlementsAfter} times (${ev.activityId}${ev.retry ? ', retry' : ''})`,
      reasons: [`settlement count for ${ev.obligationId} is ${ev.settlementsAfter}`],
      eventIndex: idx,
    });
  return out;
}

/** Policy monitors inspect actual events and the pre-execution state; they are never enabling guards. */
export function checkTransition(m: MonitorInput): Violation[] {
  const out: Violation[] = [];
  m.events.forEach((ev, idx) => {
    switch (ev.kind) {
      case 'paymentExecuted':
        out.push(...checkPayment(m, ev.payload, idx, ev));
        out.push(...p03(m, { kind: 'action', activityId: ev.activityId, actorId: ev.actorId, operation: 'execute', resource: 'gateway:payment', fields: [], purpose: 'payment-execution' }, idx));
        break;
      case 'action':
        out.push(...p03(m, ev, idx));
        break;
      case 'evidenceIssued': {
        out.push(...p03(m, { kind: 'action', activityId: ev.activityId, actorId: ev.actorId, operation: 'issueEvidence', resource: `evidence:${ev.evidence.kind}`, fields: [], purpose: 'evidence-issuance' }, idx));
        if (ev.evidence.kind === 'paymentAuthorization' && ev.preparerId) {
          const ind = independent(m.model, ev.actorId, ev.preparerId);
          if (!ind.ok)
            out.push({ policyId: 'P02', mechanism: 'dependent-approval-issued', message: `Approval issued by ${ev.actorId} is not independent of preparer ${ev.preparerId}`, reasons: [ind.reason], eventIndex: idx });
        }
        break;
      }
      case 'transfer': {
        if (ev.boundary !== 'external') break;
        const sys = m.model.systems.get(ev.to);
        const reasons: string[] = [];
        for (const f of ev.fields) {
          const bad = fieldViolation(sys, ev.purpose, f.name, f);
          if (bad) reasons.push(bad);
        }
        if (reasons.length > 0)
          out.push({
            policyId: 'P04',
            mechanism: `restricted-transfer:${ev.to}`,
            message: `${ev.activityId} transferred restricted or unpermitted fields to ${ev.to} for ${ev.purpose}`,
            reasons,
            eventIndex: idx,
          });
        break;
      }
      default:
        break;
    }
  });
  return out;
}

function p03(m: MonitorInput, ev: Extract<ModelEvent, { kind: 'action' }>, idx: number): Violation[] {
  const d = authorize(m.model, ev);
  if (d.allowed) return [];
  return [
    {
      policyId: 'P03',
      mechanism: `unauthorized:${ev.operation}:${ev.resource}`,
      message: `${ev.actorId} performed ${ev.operation} on ${ev.resource} (${ev.purpose}) outside the authorization table`,
      reasons: [d.reason],
      eventIndex: idx,
    },
  ];
}

export function checkInitial(_model: CompiledModel, _c: CaseRecord, state: ExecutionState): Violation[] {
  const n = state.facts['settle.count'];
  if (typeof n === 'number' && n > 1)
    return [{ policyId: 'P06', mechanism: 'second-settlement', message: 'Initial state already records more than one settlement', reasons: [`settle.count=${n}`], eventIndex: -1 }];
  return [];
}
