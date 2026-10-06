import type {
  ActivityContract,
  AssetInstance,
  AssetSel,
  Branch,
  CaseRecord,
  EffectExpr,
  EvidenceRecord,
  ExecutionState,
  FieldValue,
  ModelEvent,
  OnBlock,
  PaymentPayload,
  PredicateExpr,
  Ref,
  Scalar,
  TransferFieldRecord,
  TupleRef,
} from '../model/types';
import type { SystemEntity } from '../model/types';
import { cloneState, sortedUnique, stateKey } from './canonicalize';
import type { CompiledModel } from './compile';
import { hasExactGrants } from './capabilities';
import {
  approvalTuple,
  beneficiaryTuple,
  explainApproval,
  explainBeneficiary,
  explainClearance,
} from './evidence';

export interface Transition {
  id: string;
  activityId: string;
  branchId: string;
  kind: 'branch' | 'blocked';
  actorId: string;
  contract: ActivityContract;
  branch: Branch | null;
  controlId: string | null;
  onBlock: OnBlock | null;
}

export interface Applied {
  state: ExecutionState;
  events: ModelEvent[];
  consumed: TupleRef[];
  produced: TupleRef[];
  summary: string;
}

const assetKey = (kind: string, version: number) => `${kind}:${version}`;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function selectAsset(state: ExecutionState, sel: AssetSel): AssetInstance | undefined {
  if (sel.select === 'latest') {
    let best: AssetInstance | undefined;
    for (const a of Object.values(state.assets)) if (a.kind === sel.kind && (!best || a.version > best.version)) best = a;
    return best;
  }
  const v = state.facts[sel.select.fact];
  return typeof v === 'number' ? state.assets[assetKey(sel.kind, v)] : undefined;
}

function assetField(a: AssetInstance | undefined, name: string): FieldValue | undefined {
  return a?.fields[name];
}

export function initialState(model: CompiledModel, c: CaseRecord): ExecutionState {
  const facts: Record<string, Scalar> = {
    disposition: '',
    'hold.pending': false,
    'hold.reason': '',
    'settle.count': 0,
    'master.current': -1,
    'bank.next': 1,
    'draft.version': -1,
    'payment.next': 1,
    ack: '',
  };
  for (const ct of model.contracts) facts[`done.${ct.id}`] = 0;
  Object.assign(facts, c.initialFacts);
  const assets: ExecutionState['assets'] = {};
  for (const a of c.initialAssets) {
    const fields: Record<string, FieldValue> = {};
    for (const f of a.fields)
      fields[f.name] = { value: f.value, lineage: sortedUnique(f.lineage ?? []), categories: sortedUnique(f.categories ?? []), purposes: sortedUnique(f.purposes ?? []) };
    assets[assetKey(a.kind, a.version)] = { kind: a.kind, objectId: a.objectId, version: a.version, status: a.status ?? 'committed', fields };
  }
  const evidence: EvidenceRecord[] = c.initialEvidence.map((e) => ({
    id: e.id,
    kind: e.kind,
    issuer: e.issuer,
    subject: { ...e.subject },
    method: e.method,
    sources: [...e.sources],
    validFrom: e.validFrom,
    validUntil: e.validUntil,
    escalation: e.escalation ?? false,
    caseScope: e.caseScope,
    provenance: 'initial',
    issuedBy: 'fixture',
  }));
  return { facts, assets, evidence };
}

// ---------- reference / predicate evaluation ----------
function str(v: Scalar | undefined): string {
  return v == null ? '' : String(v);
}
function num(v: Scalar | undefined): number {
  return typeof v === 'number' ? v : Number.NaN;
}

interface Ctx {
  model: CompiledModel;
  c: CaseRecord;
  state: ExecutionState;
  actorId: string;
}

export function evalRef(ctx: Ctx, r: Ref): Scalar {
  switch (r.ref) {
    case 'lit':
      return r.value;
    case 'fact':
      return ctx.state.facts[r.key] ?? null;
    case 'env':
      return ctx.c.env[r.key] ?? null;
    case 'actor':
      return ctx.actorId;
    case 'field':
      return assetField(selectAsset(ctx.state, r.asset), r.name)?.value ?? null;
    case 'version':
      return selectAsset(ctx.state, r.asset)?.version ?? null;
    case 'factPlus': {
      const v = ctx.state.facts[r.key];
      return (typeof v === 'number' ? v : 0) + r.add;
    }
    case 'policy': {
      const p = ctx.model.bundle.policies.find((x) => x.id === r.policyId);
      const v = p?.params[r.key];
      return Array.isArray(v) ? null : (v ?? null);
    }
  }
}

export function resolvePayload(state: ExecutionState): PaymentPayload | null {
  let pay: AssetInstance | undefined;
  for (const a of Object.values(state.assets)) if (a.kind === 'paymentRequest' && (!pay || a.version > pay.version)) pay = a;
  const cur = state.facts['master.current'];
  const master = typeof cur === 'number' ? state.assets[assetKey('supplierMaster', cur)] : undefined;
  if (!pay || !master) return null;
  const f = (n: string) => pay!.fields[n]?.value;
  return {
    paymentId: str(f('paymentId')),
    paymentVersion: pay.version,
    invoiceId: str(f('invoiceId')),
    invoiceVersion: num(f('invoiceVersion')),
    supplierId: master.objectId,
    bankVersion: master.version,
    accountDigest: str(master.fields.accountDigest?.value),
    amountCents: num(f('amountCents')),
    currency: str(f('currency')),
    obligationId: str(f('obligationId')),
    preparerId: str(f('preparerId')),
  };
}

function snapshotTuple(state: ExecutionState): { bankVersion: number; accountDigest: string } | null {
  let pay: AssetInstance | undefined;
  for (const a of Object.values(state.assets)) if (a.kind === 'paymentRequest' && (!pay || a.version > pay.version)) pay = a;
  return pay ? { bankVersion: num(pay.fields.bankVersion?.value), accountDigest: str(pay.fields.accountDigest?.value) } : null;
}

function masterEditor(state: ExecutionState, version: number): string | null {
  const a = state.assets[assetKey('supplierMaster', version)];
  const e = a?.fields.editor?.value;
  return typeof e === 'string' && e ? e : null;
}

export function evalPredicate(ctx: Ctx, p: PredicateExpr): boolean {
  switch (p.op) {
    case 'all':
      return p.args.every((a) => evalPredicate(ctx, a));
    case 'any':
      return p.args.some((a) => evalPredicate(ctx, a));
    case 'not':
      return !evalPredicate(ctx, p.arg);
    case 'equals': {
      const l = evalRef(ctx, p.left);
      const r = evalRef(ctx, p.right);
      return l === r;
    }
    case 'compare': {
      const l = evalRef(ctx, p.left) ?? 0;
      const r = evalRef(ctx, p.right) ?? 0;
      if (typeof l !== 'number' || typeof r !== 'number') return false;
      return p.cmp === 'lt' ? l < r : p.cmp === 'lte' ? l <= r : p.cmp === 'gt' ? l > r : l >= r;
    }
    case 'exists':
      return selectAsset(ctx.state, p.asset) !== undefined;
    case 'evidence':
      return evalEvidence(ctx, p.name, p.target);
  }
}

function evalEvidence(ctx: Ctx, name: string, target: string): boolean {
  const { model, state, c } = ctx;
  switch (name) {
    case 'validBeneficiary': {
      if (target === 'draft') {
        const v = state.facts['draft.version'];
        const m = typeof v === 'number' ? state.assets[assetKey('supplierMaster', v)] : undefined;
        if (!m) return false;
        return explainBeneficiary(model, state, c.id, beneficiaryTuple({ supplierId: m.objectId, bankVersion: m.version, accountDigest: str(m.fields.accountDigest?.value) }), masterEditor(state, m.version)).valid;
      }
      const p = resolvePayload(state);
      return p ? explainBeneficiary(model, state, c.id, beneficiaryTuple(p), masterEditor(state, p.bankVersion)).valid : false;
    }
    case 'hasClearance':
      return explainClearance(model, state, c.id, str(c.env.supplierId)).valid;
    case 'validApproval': {
      const p = resolvePayload(state);
      return p ? explainApproval(model, state, c.id, p).valid : false;
    }
    case 'payloadBound': {
      const p = resolvePayload(state);
      const snap = snapshotTuple(state);
      if (!p || !snap) return false;
      if (snap.bankVersion !== p.bankVersion || snap.accountDigest !== p.accountDigest) return false;
      const want = approvalTuple(p);
      return state.evidence.some(
        (e) => e.kind === 'paymentAuthorization' && e.caseScope === c.id && Object.keys(want).every((k) => e.subject[k] === want[k]),
      );
    }
  }
  return false;
}

// ---------- transfer permission ----------
export function fieldViolation(system: SystemEntity | undefined, purpose: string, name: string, f: { categories: string[]; purposes: string[] }): string | null {
  if (!system) return `unknown recipient`;
  if (f.purposes.length === 0) return `field ${name} has no permitted purpose left after intersecting source purposes`;
  if (!f.purposes.includes(purpose)) return `purpose ${purpose} is not permitted for field ${name}`;
  if (!system.approvedPurposes.includes(purpose)) return `${system.id} is not approved for purpose ${purpose}`;
  const missing = f.categories.filter((cat) => !system.acceptedCategories.includes(cat));
  if (missing.length > 0) return `${system.id} does not accept ${missing.join('/')} data (field ${name})`;
  if (system.approvedFields && !system.approvedFields.includes(name)) return `field ${name} is outside the approved field set of ${system.id}`;
  return null;
}

// ---------- enabling ----------
export function isTerminal(state: ExecutionState): boolean {
  return state.facts.disposition !== '';
}

function activeControls(model: CompiledModel, contract: ActivityContract) {
  return contract.implementedControlIds
    .slice()
    .sort()
    .map((id) => model.controls.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.implemented === true);
}

export function enabledTransitions(model: CompiledModel, c: CaseRecord, state: ExecutionState): Transition[] {
  if (isTerminal(state)) return [];
  const out: Transition[] = [];
  const holding = state.facts['hold.pending'] === true;
  for (const contract of model.contracts) {
    if (holding && contract.operation !== 'hold') continue;
    if (!hasExactGrants(model, contract.actorId, contract.capabilityRequirements)) continue;
    const ctx: Ctx = { model, c, state, actorId: contract.actorId };
    if (!evalPredicate(ctx, contract.workflowPreconditions)) continue;
    if (!contract.inputs.every((i) => selectAsset(state, i.asset) !== undefined)) continue;

    let blocker: { controlId: string; onBlock: OnBlock | null; disabled: boolean } | null = null;
    for (const ctl of activeControls(model, contract)) {
      if (ctl.mode !== 'guard' || !ctl.guard) continue;
      if (evalPredicate(ctx, ctl.guard)) continue;
      const ob = (ctl.onBlock ?? []).find((b) => !b.when || evalPredicate(ctx, b.when)) ?? null;
      blocker = { controlId: ctl.id, onBlock: ob, disabled: ob === null };
      break;
    }
    if (blocker) {
      if (blocker.disabled) continue;
      const t: Transition = {
        id: `${contract.id}:blocked:${blocker.controlId}`,
        activityId: contract.id,
        branchId: `blocked:${blocker.controlId}`,
        kind: 'blocked',
        actorId: contract.actorId,
        contract,
        branch: null,
        controlId: blocker.controlId,
        onBlock: blocker.onBlock,
      };
      // A block that changes nothing is not a transition (it would hide a deadlock behind a self-loop).
      if (stateKey(applyTransition(model, c, state, t).state) !== stateKey(state)) out.push(t);
      continue;
    }
    const domain = c.branchDomains[contract.id];
    const branches = contract.branches.slice().sort((x, y) => (x.id < y.id ? -1 : 1));
    for (const br of branches) {
      if (domain && !domain.includes(br.id)) continue;
      if (br.when && !evalPredicate(ctx, br.when)) continue;
      out.push({
        id: `${contract.id}:${br.id}`,
        activityId: contract.id,
        branchId: br.id,
        kind: 'branch',
        actorId: contract.actorId,
        contract,
        branch: br,
        controlId: null,
        onBlock: null,
      });
    }
  }
  return out;
}

// ---------- application ----------
const tuple = (a: AssetInstance, detail?: string): TupleRef => ({ kind: a.kind, objectId: a.objectId, version: a.version, ...(detail ? { detail } : {}) });

export function applyTransition(model: CompiledModel, c: CaseRecord, before: ExecutionState, t: Transition): Applied {
  const state = cloneState(before);
  const events: ModelEvent[] = [];
  const consumed: TupleRef[] = [];
  const produced: TupleRef[] = [];
  const ctx: Ctx = { model, c, state, actorId: t.actorId };
  const contract = t.contract;

  for (const i of contract.inputs) {
    const a = selectAsset(before, i.asset);
    if (a) consumed.push(tuple(a));
  }

  if (t.kind === 'blocked') {
    events.push({
      kind: 'controlDecision',
      activityId: contract.id,
      controlId: t.controlId!,
      decision: 'block',
      reason: t.onBlock!.reason,
    });
    for (const e of t.onBlock!.effects) applyEffect(ctx, t, e, events, produced);
    return { state, events, consumed, produced, summary: `${contract.id} blocked by ${t.controlId}: ${t.onBlock!.reason}` };
  }

  const br = t.branch!;
  if (contract.operation === 'execute') gateway(ctx, t, events, consumed);
  for (const e of contract.effects) applyEffect(ctx, t, e, events, produced);
  for (const e of br.effects) applyEffect(ctx, t, e, events, produced);
  const doneKey = `done.${contract.id}`;
  const d = state.facts[doneKey];
  state.facts[doneKey] = (typeof d === 'number' ? d : 0) + 1;
  return { state, events, consumed, produced, summary: `${contract.id}/${br.id} by ${t.actorId}` };
}

/** Domain operator for W11/W14: resolve the actual proposed payload, then settle or replay under implemented controls. */
function gateway(ctx: Ctx, t: Transition, events: ModelEvent[], consumed: TupleRef[]): void {
  const { state, model } = ctx;
  const payload = resolvePayload(state);
  if (!payload) throw new Error(`${t.activityId}: no payload could be resolved`);
  const retry = t.activityId === 'W14';
  const key = `settled.${payload.obligationId}`;
  consumed.push({ kind: 'paymentPayload', objectId: payload.paymentId, version: payload.paymentVersion, detail: Object.entries(approvalTuple(payload)).map(([k, v]) => `${k}=${v}`).join('|') });

  const controls = activeControls(model, t.contract);
  for (const ctl of controls) {
    if (ctl.mode === 'guard')
      events.push({ kind: 'controlDecision', activityId: t.activityId, controlId: ctl.id, decision: 'allow', reason: 'guard satisfied' });
  }
  const idempotent = controls.find((x) => x.mode === 'idempotent');

  // narrow payload transferred to the mock gateway
  const gwId = t.contract.capabilityRequirements.find((r) => r.operation === 'submit')?.system ?? '';
  const gw = model.systems.get(gwId);
  let pay: AssetInstance | undefined;
  for (const a of Object.values(state.assets)) if (a.kind === 'paymentRequest' && (!pay || a.version > pay.version)) pay = a;
  const master = state.assets[assetKey('supplierMaster', payload.bankVersion)];
  const fields: TransferFieldRecord[] = [];
  for (const name of ['paymentId', 'supplierId', 'bankVersion', 'amountCents', 'currency', 'obligationId', 'invoiceId']) {
    const f = pay?.fields[name];
    if (f) fields.push({ name, source: `paymentRequest.${name}`, categories: f.categories, lineage: f.lineage, purposes: f.purposes });
  }
  const acct = master?.fields.accountDigest;
  if (acct) fields.push({ name: 'accountDigest', source: 'supplierMaster.accountDigest', categories: acct.categories, lineage: acct.lineage, purposes: acct.purposes });
  events.push({
    kind: 'transfer',
    activityId: t.activityId,
    actorId: t.actorId,
    to: gwId,
    boundary: gw?.boundary ?? 'external',
    purpose: 'payment-execution',
    fields,
    droppedByControl: [],
  });

  if (idempotent && state.facts[key] === 1) {
    events.push({ kind: 'controlDecision', activityId: t.activityId, controlId: idempotent.id, decision: 'replay', reason: `obligation ${payload.obligationId} already settled; prior receipt returned` });
    events.push({ kind: 'receiptReplayed', activityId: t.activityId, actorId: t.actorId, obligationId: payload.obligationId, idempotencyKey: payload.obligationId });
    return;
  }
  const settled = (typeof state.facts['settle.count'] === 'number' ? state.facts['settle.count'] : 0) + 1;
  state.facts['settle.count'] = settled;
  state.facts[key] = 1;
  events.push({ kind: 'paymentExecuted', activityId: t.activityId, actorId: t.actorId, payload, obligationId: payload.obligationId, idempotencyKey: payload.obligationId, settlementsAfter: settled, retry });
}

function applyEffect(ctx: Ctx, t: Transition, e: EffectExpr, events: ModelEvent[], produced: TupleRef[]): void {
  const { state, model } = ctx;
  switch (e.op) {
    case 'setField': {
      const v = evalRef(ctx, e.value);
      if (e.target.kind === 'fact') state.facts[e.target.key.replace('{activity}', t.activityId)] = v;
      else {
        const a = selectAsset(state, e.target.asset);
        if (!a) throw new Error(`setField: no asset ${e.target.asset.kind}`);
        const live = state.assets[assetKey(a.kind, a.version)]!;
        if (e.target.name === 'status') live.status = String(v);
        else {
          const prev = live.fields[e.target.name];
          const lineage = new Set<string>(prev?.lineage ?? []);
          const categories = new Set<string>(prev?.categories ?? []);
          let purposes: string[] | null = prev ? [...prev.purposes] : null;
          for (const d of e.derivedFrom ?? []) {
            const fv = assetField(selectAsset(state, d.asset), d.name);
            if (!fv) continue;
            fv.lineage.forEach((x) => lineage.add(x));
            fv.categories.forEach((x) => categories.add(x));
            purposes = purposes === null ? [...fv.purposes] : purposes.filter((p) => fv.purposes.includes(p));
          }
          live.fields[e.target.name] = { value: v, lineage: [...lineage].sort(), categories: [...categories].sort(), purposes: (purposes ?? []).sort() };
        }
      }
      return;
    }
    case 'incrementCounter': {
      const cur = state.facts[e.key];
      state.facts[e.key] = (typeof cur === 'number' ? cur : 0) + e.by;
      return;
    }
    case 'createAsset': {
      const version = evalRef(ctx, e.version);
      if (typeof version !== 'number') throw new Error(`createAsset ${e.kind}: version is not numeric`);
      const fields: Record<string, FieldValue> = {};
      for (const spec of e.fields) {
        const sources: FieldValue[] = [];
        for (const d of spec.derivedFrom ?? []) {
          const fv = assetField(selectAsset(state, d.asset), d.name);
          if (fv) sources.push(fv);
        }
        if (spec.value.ref === 'field') {
          const fv = assetField(selectAsset(state, spec.value.asset), spec.value.name);
          if (fv) sources.push(fv);
        }
        const lineage = new Set<string>(spec.lineage ?? []);
        const categories = new Set<string>(spec.categories ?? []);
        let purposes: string[] | null = spec.purposes ? [...spec.purposes] : null;
        for (const s of sources) {
          s.lineage.forEach((x) => lineage.add(x));
          s.categories.forEach((x) => categories.add(x));
          purposes = purposes === null ? [...s.purposes] : purposes.filter((p) => s.purposes.includes(p));
        }
        fields[spec.name] = { value: evalRef(ctx, spec.value), lineage: [...lineage].sort(), categories: [...categories].sort(), purposes: (purposes ?? []).sort() };
      }
      const inst: AssetInstance = { kind: e.kind, objectId: str(evalRef(ctx, e.objectId)), version, status: e.status ?? 'created', fields };
      state.assets[assetKey(e.kind, version)] = inst;
      produced.push(tuple(inst));
      return;
    }
    case 'issueEvidence': {
      const rec = issue(ctx, t, e);
      state.evidence.push(rec.record);
      events.push({ kind: 'evidenceIssued', activityId: t.activityId, actorId: t.actorId, evidence: rec.record, preparerId: rec.preparerId, editorId: rec.editorId });
      produced.push({ kind: `evidence:${e.kind}`, objectId: str(rec.record.subject.supplierId ?? rec.record.subject.paymentId), version: num(rec.record.subject.bankVersion ?? rec.record.subject.paymentVersion) || 0, detail: Object.entries(rec.record.subject).map(([k, v]) => `${k}=${v}`).join('|') });
      return;
    }
    case 'recordTransfer': {
      const sys = model.systems.get(e.to);
      const fields: TransferFieldRecord[] = [];
      for (const f of e.fields) {
        const a = selectAsset(state, f.asset);
        const fv = assetField(a, f.name);
        if (a && fv) fields.push({ name: f.name, source: `${a.kind}.${f.name}`, categories: fv.categories, lineage: fv.lineage, purposes: fv.purposes });
      }
      const dropped: string[] = [];
      const projecting = activeControls(model, t.contract).filter((c) => c.mode === 'transform' && c.projectAwayUnacceptedCategories);
      let kept = fields;
      if (projecting.length > 0) {
        kept = fields.filter((f) => {
          const bad = fieldViolation(sys, e.purpose, f.name, f);
          if (bad) dropped.push(f.name);
          return !bad;
        });
        if (dropped.length > 0)
          events.push({ kind: 'controlDecision', activityId: t.activityId, controlId: projecting[0]!.id, decision: 'project', reason: `projected away ${dropped.join(', ')} before transfer to ${e.to}` });
      }
      events.push({ kind: 'transfer', activityId: t.activityId, actorId: t.actorId, to: e.to, boundary: sys?.boundary ?? 'external', purpose: e.purpose, fields: kept, droppedByControl: dropped });
      return;
    }
    case 'recordAction': {
      events.push({ kind: 'action', activityId: t.activityId, actorId: t.actorId, operation: e.operation, resource: e.resource, fields: e.fields, purpose: e.purpose });
      return;
    }
    case 'setDisposition': {
      const reason = e.reason ? str(evalRef(ctx, e.reason)) : '';
      state.facts.disposition = e.disposition;
      if (e.disposition === 'held') state.facts['hold.reason'] = reason || str(state.facts['hold.reason']);
      events.push({ kind: 'disposition', activityId: t.activityId, disposition: e.disposition, reason: str(state.facts['hold.reason']) });
      return;
    }
  }
}

function issue(ctx: Ctx, t: Transition, e: Extract<EffectExpr, { op: 'issueEvidence' }>) {
  const { state, model, c } = ctx;
  let subject: Record<string, Scalar> = {};
  let preparerId: string | null = null;
  let editorId: string | null = null;
  if (e.subject === 'draft') {
    const v = state.facts['draft.version'];
    const m = typeof v === 'number' ? state.assets[assetKey('supplierMaster', v)] : undefined;
    if (!m) throw new Error('issueEvidence: no draft master');
    subject = { supplierId: m.objectId, bankVersion: m.version, accountDigest: str(m.fields.accountDigest?.value) };
    editorId = masterEditor(state, m.version);
  } else if (e.subject === 'committed') {
    const v = state.facts['master.current'];
    const m = typeof v === 'number' ? state.assets[assetKey('supplierMaster', v)] : undefined;
    if (!m) throw new Error('issueEvidence: no committed master');
    subject = { supplierId: m.objectId, bankVersion: m.version, accountDigest: str(m.fields.accountDigest?.value) };
    editorId = masterEditor(state, m.version);
  } else if (e.subject === 'supplier') {
    subject = { supplierId: str(c.env.supplierId) };
  } else {
    let pay: AssetInstance | undefined;
    for (const a of Object.values(state.assets)) if (a.kind === 'paymentRequest' && (!pay || a.version > pay.version)) pay = a;
    if (!pay) throw new Error('issueEvidence: no payment request');
    const f = (n: string) => pay!.fields[n]?.value ?? null;
    subject = {
      paymentId: f('paymentId'),
      paymentVersion: pay.version,
      invoiceId: f('invoiceId'),
      invoiceVersion: f('invoiceVersion'),
      supplierId: f('supplierId'),
      bankVersion: f('bankVersion'),
      accountDigest: f('accountDigest'),
      amountCents: f('amountCents'),
      currency: f('currency'),
    };
    preparerId = str(f('preparerId'));
  }
  const n = state.evidence.filter((x) => x.kind === e.kind).length;
  const record: EvidenceRecord = {
    id: `EV-${e.kind}-${n + 1}`,
    kind: e.kind,
    issuer: t.actorId,
    subject,
    method: str(evalRef(ctx, e.method)),
    sources: e.sources.map((s) => str(evalRef(ctx, s))).sort(),
    validFrom: model.bundle.analysisDate,
    validUntil: addDays(model.bundle.analysisDate, e.validDays),
    escalation: e.escalation ? evalRef(ctx, e.escalation) === true : false,
    caseScope: c.id,
    provenance: 'issued',
    issuedBy: t.id,
  };
  return { record, preparerId, editorId };
}

