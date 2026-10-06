import { useMemo } from 'react';
import { canonicalJson } from '../engine/canonicalize';
import { applyVariants, compileDesign, type CompiledModel } from '../engine/compile';
import type {
  ActivityContract,
  AnalysisReport,
  Design,
  EffectExpr,
  Finding,
  GoalFailure,
  ModelBundle,
  PredicateExpr,
  PrincipalEntity,
  Ref,
  Witness,
} from '../model/types';
import { ACTIVITY_ORDER } from './layout';
import { useAppState, type Overlays, type Selection, type Slot } from './state';

export interface EffectiveModels {
  /** The manual design on the same variant bundle: what "Changed" is measured against. */
  baseline: CompiledModel | null;
  effective: CompiledModel | null;
  error: string | null;
}

const MANUAL: Design = { automationIds: [], controlIds: [] };

interface CacheEntry {
  bundle: ModelBundle;
  variantIds: string[];
  design: Design;
  models: EffectiveModels;
}

/** The canvas and the inspector both need the compiled models; compile each distinct input triple once. */
let last: CacheEntry | null = null;

function compileModels(bundle: ModelBundle, variantIds: string[], design: Design): EffectiveModels {
  if (last && last.bundle === bundle && last.variantIds === variantIds && last.design === design) return last.models;
  const models = compileUncached(bundle, variantIds, design);
  last = { bundle, variantIds, design, models };
  return models;
}

function compileUncached(bundle: ModelBundle, variantIds: string[], design: Design): EffectiveModels {
  const variant = applyVariants(bundle, variantIds);
  if (!variant.ok) return { baseline: null, effective: null, error: variant.reasons.join('; ') };
  const baseline = compileDesign(variant.bundle, MANUAL);
  if (!baseline.ok) return { baseline: null, effective: null, error: baseline.reasons.join('; ') };
  const effective = compileDesign(variant.bundle, design);
  if (!effective.ok) return { baseline: baseline.model, effective: null, error: effective.reasons.join('; ') };
  return { baseline: baseline.model, effective: effective.model, error: null };
}

/** Display models derived from the same bundle the engine analyzes; no separate graph logic decides semantics. */
export function useEffectiveModel(): EffectiveModels {
  const { bundle, variantIds, design } = useAppState();
  return useMemo(() => compileModels(bundle, variantIds, design), [bundle, variantIds, design]);
}

// ---------- contract / predicate helpers ----------

export function effectsOf(contract: ActivityContract): EffectExpr[] {
  return [...contract.effects, ...contract.branches.flatMap((b) => b.effects)];
}

type LeafPredicate = Exclude<PredicateExpr, { op: 'all' | 'any' | 'not' }>;

/** Visits every leaf with its polarity (flipped under `not`). */
function walkPredicate(expr: PredicateExpr, visit: (leaf: LeafPredicate, positive: boolean) => void, positive = true): void {
  switch (expr.op) {
    case 'all':
    case 'any':
      for (const arg of expr.args) walkPredicate(arg, visit, positive);
      return;
    case 'not':
      walkPredicate(expr.arg, visit, !positive);
      return;
    default:
      visit(expr, positive);
  }
}

const DONE_PREFIX = 'done.';

function doneId(ref: Ref): string | null {
  return ref.ref === 'fact' && ref.key.startsWith(DONE_PREFIX) ? ref.key.slice(DONE_PREFIX.length) : null;
}

function literalNumber(ref: Ref): number | null {
  return ref.ref === 'lit' && typeof ref.value === 'number' ? ref.value : null;
}

/** The activity whose completion counter `done.Wxx` this leaf requires to be at least 1, if any. */
function requiredDone(leaf: LeafPredicate, positive: boolean): string | null {
  if (leaf.op === 'equals') {
    const id = doneId(leaf.left);
    const n = literalNumber(leaf.right);
    if (id === null || n === null) return null;
    return (positive && n >= 1) || (!positive && n === 0) ? id : null;
  }
  if (leaf.op === 'compare') {
    const id = doneId(leaf.left);
    const n = literalNumber(leaf.right);
    if (id === null || n === null) return null;
    if (positive) return (leaf.cmp === 'gte' && n >= 1) || (leaf.cmp === 'gt' && n >= 0) ? id : null;
    return (leaf.cmp === 'lt' && n <= 1) || (leaf.cmp === 'lte' && n <= 0) ? id : null;
  }
  return null;
}

function factKey(ref: Ref): string | null {
  return (ref.ref === 'fact' || ref.ref === 'factPlus') && !ref.key.startsWith(DONE_PREFIX) ? ref.key : null;
}

/** Non-counter facts (e.g. `ack`, `master.current`, `hold.pending`) this leaf reads. */
function readFacts(leaf: LeafPredicate): string[] {
  const keys: (string | null)[] = [];
  if (leaf.op === 'equals' || leaf.op === 'compare') keys.push(factKey(leaf.left), factKey(leaf.right));
  else if (leaf.op === 'exists' && leaf.asset.select !== 'latest') keys.push(leaf.asset.select.fact);
  return keys.filter((k): k is string => k !== null);
}

type EvidencePredicateName = Extract<PredicateExpr, { op: 'evidence' }>['name'];
type EvidenceKind = Extract<EffectExpr, { op: 'issueEvidence' }>['kind'];

const EVIDENCE_KIND_OF_PREDICATE: Record<EvidencePredicateName, EvidenceKind> = {
  validBeneficiary: 'beneficiaryVerification',
  validApproval: 'paymentAuthorization',
  payloadBound: 'paymentAuthorization',
  hasClearance: 'onboardingClearance',
};

export interface EvidenceRequirement {
  kind: EvidenceKind;
  predicate: EvidencePredicateName;
  /** Control that enforces the requirement, or null when the activity's own preconditions require it. */
  via: string | null;
}

/** Evidence an activity requires: positive evidence predicates in its preconditions/branches and in implemented control guards. */
export function evidenceRequirements(model: CompiledModel, contract: ActivityContract): EvidenceRequirement[] {
  const out: EvidenceRequirement[] = [];
  const collect = (expr: PredicateExpr, via: string | null): void =>
    walkPredicate(expr, (leaf, positive) => {
      if (leaf.op === 'evidence' && positive) out.push({ kind: EVIDENCE_KIND_OF_PREDICATE[leaf.name], predicate: leaf.name, via });
    });
  collect(contract.workflowPreconditions, null);
  for (const branch of contract.branches) if (branch.when) collect(branch.when, null);
  for (const controlId of contract.implementedControlIds) {
    const guard = model.controls.get(controlId)?.guard;
    if (guard) collect(guard, controlId);
  }
  return out;
}

// ---------- derived overlay edges ----------

export type OverlayKind = keyof Overlays;

export interface DerivedEdge {
  id: string;
  overlay: OverlayKind;
  from: string;
  to: string;
  label: string;
}

export interface DerivedTransfer {
  id: string;
  from: string;
  systemId: string;
  systemName: string;
  external: boolean;
  purpose: string;
  fieldCount: number;
}

export interface DerivedGraph {
  edges: DerivedEdge[];
  transfers: DerivedTransfer[];
}

const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  beneficiaryVerification: 'beneficiary check',
  onboardingClearance: 'clearance',
  paymentAuthorization: 'approval',
};

class EdgeAccumulator {
  private readonly byKey = new Map<string, { edge: DerivedEdge; labels: Set<string> }>();

  add(overlay: OverlayKind, from: string, to: string, label: string): void {
    if (from === to) return;
    const key = `${overlay}|${from}|${to}`;
    const hit = this.byKey.get(key);
    if (hit) hit.labels.add(label);
    else this.byKey.set(key, { edge: { id: key, overlay, from, to, label }, labels: new Set([label]) });
  }

  list(): DerivedEdge[] {
    return [...this.byKey.values()].map(({ edge, labels }) => ({ ...edge, label: [...labels].join(', ') }));
  }
}

/**
 * Overlay edges derived from the effective contracts only:
 *  - dependency: `done.Wxx` scheduling preconditions plus producers of the non-counter facts a precondition reads;
 *  - data: asset kinds created/updated by one contract and consumed as inputs by a later one, and `recordTransfer` effects;
 *  - authority: `issueEvidence` effects to the contracts that require that evidence kind (preconditions or control guards).
 */
export function deriveGraph(model: CompiledModel): DerivedGraph {
  const contracts = model.contracts;
  const ids = new Set(contracts.map((c) => c.id));
  const order = new Map<string, number>();
  for (const id of ACTIVITY_ORDER) order.set(id, order.size);
  for (const c of contracts) if (!order.has(c.id)) order.set(c.id, order.size);
  const acc = new EdgeAccumulator();

  const factProducers = new Map<string, string[]>();
  for (const c of contracts)
    for (const f of effectsOf(c))
      if (f.op === 'setField' && f.target.kind === 'fact') factProducers.set(f.target.key, [...(factProducers.get(f.target.key) ?? []), c.id]);

  for (const c of contracts) {
    walkPredicate(c.workflowPreconditions, (leaf, positive) => {
      const required = requiredDone(leaf, positive);
      if (required !== null && ids.has(required)) acc.add('dependency', required, c.id, 'after');
      for (const key of readFacts(leaf)) for (const producer of factProducers.get(key) ?? []) acc.add('dependency', producer, c.id, key);
    });
  }

  const producedKinds = (c: ActivityContract): Set<string> => {
    const kinds = new Set<string>();
    for (const f of effectsOf(c)) {
      if (f.op === 'createAsset') kinds.add(f.kind);
      else if (f.op === 'setField' && f.target.kind === 'asset') kinds.add(f.target.asset.kind);
    }
    return kinds;
  };
  for (const consumer of contracts)
    for (const input of consumer.inputs)
      for (const producer of contracts)
        if (producer.id !== consumer.id && (order.get(producer.id) ?? 0) < (order.get(consumer.id) ?? 0) && producedKinds(producer).has(input.asset.kind))
          acc.add('data', producer.id, consumer.id, input.asset.kind);

  const issuers = new Map<EvidenceKind, string[]>();
  for (const c of contracts)
    for (const f of effectsOf(c)) if (f.op === 'issueEvidence' && !(issuers.get(f.kind) ?? []).includes(c.id)) issuers.set(f.kind, [...(issuers.get(f.kind) ?? []), c.id]);
  for (const consumer of contracts)
    for (const req of evidenceRequirements(model, consumer))
      for (const issuer of issuers.get(req.kind) ?? [])
        acc.add('authority', issuer, consumer.id, req.via ? `${EVIDENCE_LABEL[req.kind]} via ${req.via}` : EVIDENCE_LABEL[req.kind]);

  const transfers = new Map<string, DerivedTransfer>();
  for (const c of contracts)
    for (const f of effectsOf(c)) {
      if (f.op !== 'recordTransfer') continue;
      const id = `${c.id}>${f.to}:${f.purpose}`;
      const system = model.systems.get(f.to);
      transfers.set(id, {
        id,
        from: c.id,
        systemId: f.to,
        systemName: system?.name ?? f.to,
        external: system?.boundary === 'external',
        purpose: f.purpose,
        fieldCount: Math.max(f.fields.length, transfers.get(id)?.fieldCount ?? 0),
      });
    }
  return { edges: acc.list(), transfers: [...transfers.values()] };
}

// ---------- per-activity display view ----------

export type ActivityStatus = 'present' | 'removed' | 'absent';

export interface ActivityView {
  id: string;
  name: string;
  lane: 'supplier' | 'invoice';
  conditional: boolean;
  status: ActivityStatus;
  /** Automations/variants whose patches remove this activity's contract; empty when status is not `removed`. */
  removedBy: string[];
  actorId: string | null;
  actorName: string | null;
  actorKind: PrincipalEntity['principalKind'] | null;
  controlIds: string[];
  changed: boolean;
  changeReasons: string[];
}

/** Differences between the manual-baseline contract and the effective contract: actor, preconditions, controls, contract body. */
export function changeReasons(baseline: ActivityContract | undefined, effective: ActivityContract | undefined): string[] {
  if (!baseline && !effective) return [];
  if (!baseline) return ['Added by the effective design'];
  if (!effective) return ['Removed by the effective design'];
  const reasons: string[] = [];
  if (baseline.actorId !== effective.actorId) reasons.push(`Actor ${baseline.actorId} → ${effective.actorId}`);
  if (canonicalJson(baseline.workflowPreconditions) !== canonicalJson(effective.workflowPreconditions)) reasons.push('Workflow preconditions differ');
  const before = [...baseline.implementedControlIds].sort();
  const after = [...effective.implementedControlIds].sort();
  if (before.join('|') !== after.join('|')) reasons.push(`Controls [${before.join(', ') || 'none'}] → [${after.join(', ') || 'none'}]`);
  const body = (c: ActivityContract): string => canonicalJson({ i: c.inputs, r: c.capabilityRequirements, e: c.effects, b: c.branches, o: c.operation });
  if (body(baseline) !== body(effective)) reasons.push('Inputs, capability requirements, effects or branches differ');
  return reasons;
}

/** Automations and variants (by their structured patch ops) that remove the activity's contract. */
function removers(model: CompiledModel, activityId: string): string[] {
  const removes = (patch: ModelBundle['automations'][number]['patch']): boolean => patch.some((op) => op.op === 'removeContract' && op.id === activityId);
  return [
    ...model.effective.requestedAutomationIds.filter((id) => model.bundle.automations.some((a) => a.id === id && removes(a.patch))),
    ...model.effective.variantIds.filter((id) => model.bundle.variants.some((v) => v.id === id && removes(v.patch))).map((id) => `variant ${id}`),
  ];
}

export function describeActivities(baseline: CompiledModel | null, effective: CompiledModel): ActivityView[] {
  const views: ActivityView[] = [];
  for (const entity of effective.bundle.entities) {
    if (entity.kind !== 'Activity') continue;
    const now = effective.contractById.get(entity.id);
    const was = baseline?.contractById.get(entity.id);
    const contract = now ?? was;
    const actor = contract ? effective.principals.get(contract.actorId) : undefined;
    const removedBy = now ? [] : removers(effective, entity.id);
    const reasons = now ? changeReasons(was, now) : [];
    views.push({
      id: entity.id,
      name: entity.name,
      lane: entity.lane,
      conditional: entity.conditional,
      status: now ? 'present' : removedBy.length > 0 ? 'removed' : 'absent',
      removedBy,
      actorId: contract?.actorId ?? null,
      actorName: actor?.name ?? contract?.actorId ?? null,
      actorKind: actor?.principalKind ?? null,
      controlIds: now ? [...now.implementedControlIds].sort() : [],
      changed: reasons.length > 0,
      changeReasons: reasons,
    });
  }
  return views;
}

// ---------- selected witness ----------

export interface SelectedWitness {
  id: string;
  finding: Finding | null;
  goalFailure: GoalFailure | null;
  witness: Witness;
  /** Step shown in detail: the selected step, or the step at which the violation is observed. */
  focusIndex: number;
}

/** Resolves a finding/step selection to its witness in the completed analysis; null while idle, running, failed or unrelated. */
export function resolveSelectedWitness(selection: Selection, analysis: Slot<AnalysisReport>): SelectedWitness | null {
  if (analysis.status !== 'done') return null;
  const id = selection?.type === 'finding' ? selection.id : selection?.type === 'step' ? selection.findingId : null;
  if (id === null) return null;
  const finding = analysis.value.findings.find((f) => f.id === id) ?? null;
  const goalFailure = finding ? null : (analysis.value.goalFailures.find((g) => g.id === id) ?? null);
  const witness = finding?.witness ?? goalFailure?.witness ?? null;
  if (!witness) return null;
  return { id, finding, goalFailure, witness, focusIndex: selection?.type === 'step' ? selection.index : witness.violation.stepIndex };
}
