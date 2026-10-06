import type { CapabilityRequirement, ModelEvent } from '../model/types';
import { GRANT_KEY, type CompiledModel } from './compile';

/** Technical ability: an exact grant for the actor. Roles and departments confer nothing. */
export function hasExactGrants(model: CompiledModel, actorId: string, reqs: readonly CapabilityRequirement[]): boolean {
  return reqs.every((r) => model.grantKeys.has(GRANT_KEY({ principalId: actorId, ...r })));
}

export interface AuthDecision {
  allowed: boolean;
  reason: string;
}

type ActionEvent = Extract<ModelEvent, { kind: 'action' }>;

/** Normative authorization: deny overrides allow; no matching allow means prohibited. */
export function authorize(model: CompiledModel, ev: ActionEvent): AuthDecision {
  const roles = new Set(model.principals.get(ev.actorId)?.roleIds ?? []);
  let allowRule: string | null = null;
  for (const rule of model.bundle.authorization) {
    const actorMatch = rule.principalIds.includes(ev.actorId) || rule.roleIds.some((r) => roles.has(r));
    if (!actorMatch) continue;
    if (!rule.operations.includes(ev.operation)) continue;
    if (!rule.resources.includes(ev.resource)) continue;
    // an allow must cover every touched field; a deny fires when any touched field is denied
    if (rule.fields && (rule.effect === 'allow' ? !ev.fields.every((f) => rule.fields!.includes(f)) : !ev.fields.some((f) => rule.fields!.includes(f)))) continue;
    if (!rule.purposes.includes(ev.purpose)) continue;
    if (rule.effect === 'deny') return { allowed: false, reason: `denied by rule ${rule.id}` };
    allowRule ??= rule.id;
  }
  if (allowRule) return { allowed: true, reason: `allowed by rule ${allowRule}` };
  return {
    allowed: false,
    reason: `no allow rule matches ${ev.actorId} ${ev.operation} ${ev.resource}${ev.fields.length ? `[${ev.fields.join(',')}]` : ''} for ${ev.purpose}`,
  };
}

/** Grants an actor holds that no effective contract of that actor requires: capability excess (not a witnessed execution). */
export function capabilityExcess(model: CompiledModel) {
  const required = new Set<string>();
  for (const c of model.contracts)
    for (const r of c.capabilityRequirements) required.add(GRANT_KEY({ principalId: c.actorId, ...r }));
  return model.bundle.capabilities
    .filter((g) => !required.has(GRANT_KEY(g)))
    .map((g) => ({
      principalId: g.principalId,
      grantId: g.id,
      system: g.system,
      operation: g.operation,
      resource: g.resource,
      message: `${g.principalId} can technically ${g.operation} ${g.resource} on ${g.system}, but no effective workflow contract uses this ability.`,
    }));
}
