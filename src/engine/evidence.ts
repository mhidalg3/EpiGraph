import type { EvidenceRecord, ExecutionState, PaymentPayload } from '../model/types';
import type { CompiledModel } from './compile';

export interface EvidenceVerdict {
  valid: boolean;
  evidenceId: string | null;
  reasons: string[];
}

export function policyList(model: CompiledModel, policyId: string, key: string): string[] {
  const p = model.bundle.policies.find((x) => x.id === policyId);
  const v = p?.params[key];
  return Array.isArray(v) ? v : [];
}

export function policyNumber(model: CompiledModel, policyId: string, key: string): number {
  const p = model.bundle.policies.find((x) => x.id === policyId);
  const v = p?.params[key];
  return typeof v === 'number' ? v : Number.NaN;
}

/** Independence is judged on effective credential and the policy-scoped independence group, never on labels or roles. */
export function independent(model: CompiledModel, a: string, b: string): { ok: boolean; reason: string } {
  if (a === b) return { ok: false, reason: `${a} and ${b} are the same principal` };
  const pa = model.principals.get(a);
  const pb = model.principals.get(b);
  if (!pa || !pb) return { ok: false, reason: `unknown principal ${!pa ? a : b}` };
  if (pa.effectiveIdentityId === pb.effectiveIdentityId)
    return { ok: false, reason: `${a} and ${b} share effective credential ${pa.effectiveIdentityId}` };
  if (pa.independenceGroup === pb.independenceGroup)
    return { ok: false, reason: `${a} and ${b} share independence group ${pa.independenceGroup}` };
  return { ok: true, reason: '' };
}

export function beneficiaryTuple(p: Pick<PaymentPayload, 'supplierId' | 'bankVersion' | 'accountDigest'>) {
  return { supplierId: p.supplierId, bankVersion: p.bankVersion, accountDigest: p.accountDigest };
}

export function approvalTuple(p: PaymentPayload): Record<string, string | number> {
  return {
    paymentId: p.paymentId,
    paymentVersion: p.paymentVersion,
    invoiceId: p.invoiceId,
    invoiceVersion: p.invoiceVersion,
    supplierId: p.supplierId,
    bankVersion: p.bankVersion,
    accountDigest: p.accountDigest,
    amountCents: p.amountCents,
    currency: p.currency,
  };
}

export function fingerprint(p: PaymentPayload): string {
  const t = approvalTuple(p);
  return Object.keys(t)
    .map((k) => `${k}=${t[k]}`)
    .join('|');
}

function validAt(e: EvidenceRecord, date: string): string | null {
  if (date < e.validFrom) return `evidence ${e.id} is not yet valid (from ${e.validFrom}, analysis date ${date})`;
  if (date > e.validUntil) return `evidence ${e.id} expired on ${e.validUntil} (analysis date ${date})`;
  return null;
}

/** ValidBeneficiary(e, p): exact tuple, authorized issuer, independence from the bank-detail editor, admitted method/source, validity. */
export function explainBeneficiary(
  model: CompiledModel,
  state: ExecutionState,
  caseId: string,
  tuple: { supplierId: string; bankVersion: number; accountDigest: string },
  editorId: string | null,
): EvidenceVerdict {
  const verifierRoles = policyList(model, 'P01', 'verifierRoleIds');
  const methods = policyList(model, 'P01', 'admittedMethods');
  const trusted = policyList(model, 'P01', 'trustedSources');
  const date = model.bundle.analysisDate;
  const candidates = state.evidence.filter((e) => e.kind === 'beneficiaryVerification');
  if (candidates.length === 0)
    return {
      valid: false,
      evidenceId: null,
      reasons: [`no beneficiary verification evidence exists for (${tuple.supplierId}, v${tuple.bankVersion}, ${tuple.accountDigest})`],
    };
  const reasons: string[] = [];
  for (const e of candidates) {
    const why: string[] = [];
    const s = e.subject;
    if (s.supplierId !== tuple.supplierId) why.push(`evidence ${e.id} is for supplier ${String(s.supplierId)}, not ${tuple.supplierId}`);
    if (s.bankVersion !== tuple.bankVersion) why.push(`evidence ${e.id} is for bank version ${String(s.bankVersion)}, not v${tuple.bankVersion}`);
    if (s.accountDigest !== tuple.accountDigest) why.push(`evidence ${e.id} is for account digest ${String(s.accountDigest)}, not ${tuple.accountDigest}`);
    if (e.caseScope !== caseId) why.push(`evidence ${e.id} belongs to case ${e.caseScope}, not ${caseId}`);
    if (why.length === 0) {
      const issuer = model.principals.get(e.issuer);
      if (!issuer || !issuer.roleIds.some((r) => verifierRoles.includes(r)))
        why.push(`issuer ${e.issuer} is not authorized to verify beneficiaries`);
      if (editorId) {
        const ind = independent(model, e.issuer, editorId);
        if (!ind.ok) why.push(`issuer not independent of bank-detail editor: ${ind.reason}`);
      } else why.push('bank-detail editor is unknown, independence cannot be established');
      if (!methods.includes(e.method)) why.push(`method ${e.method} is not admitted by P01`);
      if (e.sources.length === 0 || !e.sources.every((x) => trusted.includes(x)))
        why.push(`sources [${e.sources.join(', ')}] are not an approved independent source`);
      const expiry = validAt(e, date);
      if (expiry) why.push(expiry);
    }
    if (why.length === 0) return { valid: true, evidenceId: e.id, reasons: [] };
    reasons.push(...why);
  }
  return { valid: false, evidenceId: null, reasons };
}

/** ValidApproval(e, p): full fingerprint match, authorized approver, independence from the preparer, validity. */
export function explainApproval(
  model: CompiledModel,
  state: ExecutionState,
  caseId: string,
  payload: PaymentPayload,
): EvidenceVerdict {
  const approverRoles = policyList(model, 'P02', 'approverRoleIds');
  const date = model.bundle.analysisDate;
  const want = approvalTuple(payload);
  const candidates = state.evidence.filter((e) => e.kind === 'paymentAuthorization');
  if (candidates.length === 0) return { valid: false, evidenceId: null, reasons: ['no payment authorization exists'] };
  const reasons: string[] = [];
  for (const e of candidates) {
    const why: string[] = [];
    for (const k of Object.keys(want))
      if (e.subject[k] !== want[k]) why.push(`approval ${e.id} binds ${k}=${String(e.subject[k])}, executed payload has ${String(want[k])}`);
    if (e.caseScope !== caseId) why.push(`approval ${e.id} belongs to case ${e.caseScope}`);
    if (why.length === 0) {
      const issuer = model.principals.get(e.issuer);
      if (!issuer || !issuer.roleIds.some((r) => approverRoles.includes(r))) why.push(`issuer ${e.issuer} is not an authorized approver`);
      const ind = independent(model, e.issuer, payload.preparerId);
      if (!ind.ok) why.push(`approver not independent of preparer: ${ind.reason}`);
      const expiry = validAt(e, date);
      if (expiry) why.push(expiry);
    }
    if (why.length === 0) return { valid: true, evidenceId: e.id, reasons: [] };
    reasons.push(...why);
  }
  return { valid: false, evidenceId: null, reasons };
}

/** Onboarding clearance is scoped to the supplier. */
export function explainClearance(model: CompiledModel, state: ExecutionState, caseId: string, supplierId: string): EvidenceVerdict {
  const roles = policyList(model, 'P05', 'clearanceRoleIds');
  const date = model.bundle.analysisDate;
  const candidates = state.evidence.filter((e) => e.kind === 'onboardingClearance');
  if (candidates.length === 0) return { valid: false, evidenceId: null, reasons: [`no onboarding clearance exists for ${supplierId}`] };
  const reasons: string[] = [];
  for (const e of candidates) {
    const why: string[] = [];
    if (e.subject.supplierId !== supplierId) why.push(`clearance ${e.id} is for ${String(e.subject.supplierId)}, not ${supplierId}`);
    if (e.caseScope !== caseId) why.push(`clearance ${e.id} belongs to case ${e.caseScope}`);
    const issuer = model.principals.get(e.issuer);
    if (why.length === 0 && (!issuer || !issuer.roleIds.some((r) => roles.includes(r)))) why.push(`issuer ${e.issuer} is not an authorized clearer`);
    if (why.length === 0) {
      const expiry = validAt(e, date);
      if (expiry) why.push(expiry);
    }
    if (why.length === 0) return { valid: true, evidenceId: e.id, reasons: [] };
    reasons.push(...why);
  }
  return { valid: false, evidenceId: null, reasons };
}
