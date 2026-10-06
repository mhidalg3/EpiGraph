import { canonicalJson } from '../engine/canonicalize';
import type { CompiledModel } from '../engine/compile';
import type { ActivityContract, ModelBundle } from '../model/types';
import { ACTIVITY_ORDER } from './layout';

/** How an automation's patch touches one workflow activity. */
export type ImpactKind = 'removed' | 'actor' | 'contract' | 'rules' | 'controls';

export interface ActivityImpact {
  automationId: string;
  activityId: string;
  kinds: ImpactKind[];
  /** One plain-language sentence per patch operation that touches the activity. */
  notes: string[];
}

/** Short chip wording per kind (graph nodes and legend). */
export const IMPACT_SHORT: Record<ImpactKind, string> = {
  removed: 'removed',
  actor: 'agent',
  contract: 'rewritten',
  rules: 'rules',
  controls: 'controls',
};

type PatchOp = ModelBundle['automations'][number]['patch'][number];

/** Distinct hues (all >= 4.5:1 on white) for up to three automations; the id letter is always shown too. */
const PALETTE = ['#7c3aed', '#be185d', '#0369a1'] as const;

export function automationColor(bundle: ModelBundle, automationId: string): string {
  const index = bundle.automations.findIndex((a) => a.id === automationId);
  return PALETTE[(index < 0 ? 0 : index) % PALETTE.length]!;
}

/** Controls may attach safeguards after an automation replaces a contract; ignore only that control list when checking whether the replacement remains. */
function contractWithoutControls(contract: ActivityContract | undefined): Omit<ActivityContract, 'implementedControlIds'> | null {
  if (!contract) return null;
  const { implementedControlIds: _controls, ...rest } = contract;
  return rest;
}

/** Whether a patch op's effect still holds in the compiled design (later control patches can undo automation ops, e.g. C2 restores W09). */
function holdsIn(op: PatchOp, model: CompiledModel): boolean {
  switch (op.op) {
    case 'removeContract':
      return !model.contractById.has(op.id);
    case 'setActor':
      return model.contractById.get(op.id)?.actorId === op.actorId;
    case 'setContract':
      return canonicalJson(contractWithoutControls(model.contractById.get(op.contract.id))) === canonicalJson(contractWithoutControls(op.contract));
    case 'ensureContract':
      return model.contractById.has(op.contract.id);
    case 'setPrecondition':
      return canonicalJson(model.contractById.get(op.id)?.workflowPreconditions ?? null) === canonicalJson(op.expr);
    case 'setBranches':
      return canonicalJson(model.contractById.get(op.id)?.branches ?? null) === canonicalJson(op.branches);
    case 'addControl':
      return model.contractById.get(op.id)?.implementedControlIds.includes(op.controlId) ?? false;
    case 'removeControl':
      return !(model.contractById.get(op.id)?.implementedControlIds.includes(op.controlId) ?? false);
    default:
      return true;
  }
}

function touch(op: PatchOp, nameOf: (id: string) => string): { activityId: string; kind: ImpactKind; note: string } | null {
  switch (op.op) {
    case 'removeContract':
      return { activityId: op.id, kind: 'removed', note: 'Step removed from the workflow' };
    case 'setActor':
      return { activityId: op.id, kind: 'actor', note: `Performed by ${nameOf(op.actorId)}` };
    case 'setContract':
    case 'ensureContract':
      return { activityId: op.contract.id, kind: 'contract', note: 'Step logic rewritten' };
    case 'setPrecondition':
      return { activityId: op.id, kind: 'rules', note: 'Preconditions changed' };
    case 'setBranches':
      return { activityId: op.id, kind: 'rules', note: 'Outcome branches changed' };
    case 'addControl':
      return { activityId: op.id, kind: 'controls', note: `Adds control ${op.controlId}` };
    case 'removeControl':
      return { activityId: op.id, kind: 'controls', note: `Removes control ${op.controlId}` };
    default:
      return null;
  }
}

const orderOf = (activityId: string): number => {
  const i = ACTIVITY_ORDER.indexOf(activityId);
  return i < 0 ? ACTIVITY_ORDER.length : i;
};

/**
 * Activities one automation touches, derived from its structured patch ops (no separate graph semantics), in canvas order.
 * With `effective`, only ops whose effect still holds in that compiled design are kept; without it, the raw patch (what the automation would change).
 */
export function automationImpacts(bundle: ModelBundle, automationId: string, effective?: CompiledModel): ActivityImpact[] {
  const automation = bundle.automations.find((a) => a.id === automationId);
  if (!automation) return [];
  const nameOf = (id: string): string => bundle.entities.find((e) => e.id === id)?.name ?? id;
  const activityIds = new Set(bundle.entities.filter((e) => e.kind === 'Activity').map((e) => e.id));
  const byActivity = new Map<string, ActivityImpact>();
  for (const op of automation.patch) {
    const hit = touch(op, nameOf);
    if (!hit || !activityIds.has(hit.activityId) || (effective && !holdsIn(op, effective))) continue;
    const entry = byActivity.get(hit.activityId) ?? { automationId, activityId: hit.activityId, kinds: [], notes: [] };
    if (!entry.kinds.includes(hit.kind)) entry.kinds.push(hit.kind);
    entry.notes.push(hit.note);
    byActivity.set(hit.activityId, entry);
  }
  return [...byActivity.values()].sort((a, b) => orderOf(a.activityId) - orderOf(b.activityId) || a.activityId.localeCompare(b.activityId));
}

/** `W02 · W03 (removed)` style summary. */
export function impactSummary(impacts: ActivityImpact[]): string {
  return impacts.map((i) => (i.kinds.includes('removed') ? `${i.activityId} (removed)` : i.activityId)).join(' · ');
}
