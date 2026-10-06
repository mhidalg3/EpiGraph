import type {
  ActivityContract,
  CapabilityGrant,
  ControlEntity,
  Design,
  EffectiveDesign,
  ModelBundle,
  PatchOp,
  PatchProvenance,
  PrincipalEntity,
  SystemEntity,
} from '../model/types';
import { canonicalJson, sortedUnique } from './canonicalize';

export interface CompiledModel {
  bundle: ModelBundle;
  contracts: ActivityContract[];
  contractById: Map<string, ActivityContract>;
  principals: Map<string, PrincipalEntity>;
  systems: Map<string, SystemEntity>;
  controls: Map<string, ControlEntity>;
  grantKeys: Set<string>;
  effective: EffectiveDesign;
  semanticKey: string;
}

export type CompileResult = { ok: true; model: CompiledModel } | { ok: false; reasons: string[] };

const GRANT_KEY = (g: { principalId: string; system: string; operation: string; resource: string }) =>
  `${g.principalId}|${g.system}|${g.operation}|${g.resource}`;
export { GRANT_KEY };

function conflictKey(op: PatchOp): { key: string; value: string } | null {
  switch (op.op) {
    case 'setContract':
    case 'removeContract':
    case 'ensureContract': {
      if (op.op === 'ensureContract') return null;
      const id = op.op === 'setContract' ? op.contract.id : op.id;
      return { key: `contract:${id}`, value: canonicalJson(op) };
    }
    case 'setPrecondition':
      return { key: `pre:${op.id}`, value: canonicalJson(op.expr) };
    case 'setBranches':
      return { key: `branches:${op.id}`, value: canonicalJson(op.branches) };
    case 'setActor':
      return { key: `actor:${op.id}`, value: op.actorId };
    case 'addControl':
      return { key: `control:${op.id}:${op.controlId}`, value: 'add' };
    case 'removeControl':
      return { key: `control:${op.id}:${op.controlId}`, value: 'remove' };
    case 'addCapability':
      return { key: `grant:${op.grant.id}`, value: 'add:' + canonicalJson(op.grant) };
    case 'removeCapability':
      return { key: `grant:${op.grantId}`, value: 'remove' };
    case 'addAuthRule':
      return { key: `rule:${op.rule.id}`, value: 'add:' + canonicalJson(op.rule) };
    case 'removeAuthRule':
      return { key: `rule:${op.ruleId}`, value: 'remove' };
    case 'setSystem':
      return { key: `system:${op.id}`, value: canonicalJson(op) };
    case 'setPrincipal':
      return { key: `principal:${op.id}`, value: canonicalJson(op) };
    case 'setControlImplementation':
      return { key: `impl:${op.id}`, value: String(op.implemented) };
    case 'setCompleteness':
      return { key: `completeness:${op.key}`, value: op.value };
    case 'setLabel':
      return { key: `label:${op.id}`, value: op.name };
  }
}

function describeOp(op: PatchOp): string {
  switch (op.op) {
    case 'setContract':
    case 'ensureContract':
      return `${op.op} ${op.contract.id}`;
    case 'removeContract':
      return `removeContract ${op.id}`;
    case 'setPrecondition':
      return `setPrecondition ${op.id}`;
    case 'setBranches':
      return `setBranches ${op.id}`;
    case 'setActor':
      return `setActor ${op.id} → ${op.actorId}`;
    case 'addControl':
    case 'removeControl':
      return `${op.op} ${op.controlId} on ${op.id}`;
    case 'addCapability':
      return `addCapability ${op.grant.id}`;
    case 'removeCapability':
      return `removeCapability ${op.grantId}`;
    case 'addAuthRule':
      return `addAuthRule ${op.rule.id}`;
    case 'removeAuthRule':
      return `removeAuthRule ${op.ruleId}`;
    case 'setSystem':
      return `setSystem ${op.id}`;
    case 'setPrincipal':
      return `setPrincipal ${op.id}`;
    case 'setControlImplementation':
      return `setControlImplementation ${op.id}=${String(op.implemented)}`;
    case 'setCompleteness':
      return `setCompleteness ${op.key}=${op.value}`;
    case 'setLabel':
      return `setLabel ${op.id}`;
  }
}

function sortContracts(b: ModelBundle): void {
  b.contracts.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Apply one op in place on a (cloned) bundle. Returns whether it changed anything. Unknown targets throw. */
function applyOp(b: ModelBundle, op: PatchOp): boolean {
  const contract = (id: string): ActivityContract | undefined => b.contracts.find((c) => c.id === id);
  switch (op.op) {
    case 'setContract': {
      const idx = b.contracts.findIndex((c) => c.id === op.contract.id);
      const next = structuredClone(op.contract);
      if (idx >= 0) {
        if (canonicalJson(b.contracts[idx]) === canonicalJson(next)) return false;
        b.contracts[idx] = next;
      } else b.contracts.push(next);
      sortContracts(b);
      return true;
    }
    case 'ensureContract': {
      if (contract(op.contract.id)) return false;
      b.contracts.push(structuredClone(op.contract));
      sortContracts(b);
      return true;
    }
    case 'removeContract': {
      const idx = b.contracts.findIndex((c) => c.id === op.id);
      if (idx < 0) return false;
      b.contracts.splice(idx, 1);
      return true;
    }
    case 'setPrecondition': {
      const c = contract(op.id);
      if (!c) return false;
      if (canonicalJson(c.workflowPreconditions) === canonicalJson(op.expr)) return false;
      c.workflowPreconditions = structuredClone(op.expr);
      return true;
    }
    case 'setBranches': {
      const c = contract(op.id);
      if (!c) return false;
      if (canonicalJson(c.branches) === canonicalJson(op.branches)) return false;
      c.branches = structuredClone(op.branches);
      return true;
    }
    case 'setActor': {
      const c = contract(op.id);
      if (!c || c.actorId === op.actorId) return false;
      c.actorId = op.actorId;
      return true;
    }
    case 'addControl': {
      const c = contract(op.id);
      if (!c || c.implementedControlIds.includes(op.controlId)) return false;
      c.implementedControlIds = sortedUnique([...c.implementedControlIds, op.controlId]);
      return true;
    }
    case 'removeControl': {
      const c = contract(op.id);
      if (!c || !c.implementedControlIds.includes(op.controlId)) return false;
      c.implementedControlIds = c.implementedControlIds.filter((x) => x !== op.controlId);
      return true;
    }
    case 'addCapability': {
      if (b.capabilities.some((g) => g.id === op.grant.id)) return false;
      b.capabilities.push(structuredClone(op.grant));
      b.capabilities.sort((x, y) => (x.id < y.id ? -1 : 1));
      return true;
    }
    case 'removeCapability': {
      const idx = b.capabilities.findIndex((g) => g.id === op.grantId);
      if (idx < 0) return false;
      b.capabilities.splice(idx, 1);
      return true;
    }
    case 'addAuthRule': {
      if (b.authorization.some((r) => r.id === op.rule.id)) return false;
      b.authorization.push(structuredClone(op.rule));
      b.authorization.sort((x, y) => (x.id < y.id ? -1 : 1));
      return true;
    }
    case 'removeAuthRule': {
      const idx = b.authorization.findIndex((r) => r.id === op.ruleId);
      if (idx < 0) return false;
      b.authorization.splice(idx, 1);
      return true;
    }
    case 'setSystem': {
      const s = b.entities.find((e) => e.kind === 'System' && e.id === op.id);
      if (!s || s.kind !== 'System') throw new Error(`setSystem: unknown system ${op.id}`);
      const before = canonicalJson(s);
      if (op.boundary) s.boundary = op.boundary;
      if (op.acceptedCategories) s.acceptedCategories = [...op.acceptedCategories];
      if (op.approvedPurposes) s.approvedPurposes = [...op.approvedPurposes];
      return before !== canonicalJson(s);
    }
    case 'setPrincipal': {
      const p = b.entities.find((e) => e.kind === 'Principal' && e.id === op.id);
      if (!p || p.kind !== 'Principal') throw new Error(`setPrincipal: unknown principal ${op.id}`);
      const before = canonicalJson(p);
      if (op.effectiveIdentityId) p.effectiveIdentityId = op.effectiveIdentityId;
      if (op.independenceGroup) p.independenceGroup = op.independenceGroup;
      return before !== canonicalJson(p);
    }
    case 'setControlImplementation': {
      const c = b.entities.find((e) => e.kind === 'Control' && e.id === op.id);
      if (!c || c.kind !== 'Control') throw new Error(`setControlImplementation: unknown control ${op.id}`);
      if (c.implemented === op.implemented) return false;
      c.implemented = op.implemented;
      return true;
    }
    case 'setCompleteness': {
      if (b.completeness[op.key] === op.value) return false;
      b.completeness[op.key] = op.value;
      return true;
    }
    case 'setLabel': {
      const e = b.entities.find((x) => x.id === op.id);
      if (!e) throw new Error(`setLabel: unknown entity ${op.id}`);
      if ('name' in e) {
        if (e.name === op.name) return false;
        e.name = op.name;
        return true;
      }
      return false;
    }
  }
}

interface StagePatch {
  source: string;
  ops: PatchOp[];
}

function checkConflicts(stage: StagePatch[]): string[] {
  const seen = new Map<string, { value: string; source: string }>();
  const reasons: string[] = [];
  for (const p of stage) {
    for (const op of p.ops) {
      const ck = conflictKey(op);
      if (!ck) continue;
      const prev = seen.get(ck.key);
      if (prev && prev.value !== ck.value) {
        reasons.push(`Conflicting patch assignments for ${ck.key} between ${prev.source} and ${p.source}`);
      } else if (!prev) seen.set(ck.key, { value: ck.value, source: p.source });
    }
  }
  return reasons;
}

function applyStage(
  b: ModelBundle,
  stage: StagePatch[],
  stageName: PatchProvenance['stage'],
  provenance: PatchProvenance[],
): void {
  for (const p of stage) {
    const changedOps: string[] = [];
    for (const op of p.ops) if (applyOp(b, op)) changedOps.push(describeOp(op));
    provenance.push({
      source: p.source,
      stage: stageName,
      changed: changedOps.length > 0,
      summary: changedOps.length > 0 ? changedOps.join('; ') : 'no effective change (already present or not applicable)',
    });
  }
}

/** Apply named model-variant patches to a fresh clone of the bundle. */
export function applyVariants(
  bundle: ModelBundle,
  variantIds: readonly string[],
): { ok: true; bundle: ModelBundle } | { ok: false; reasons: string[] } {
  const ids = sortedUnique(variantIds);
  const stage: StagePatch[] = [];
  const reasons: string[] = [];
  for (const id of ids) {
    const v = bundle.variants.find((x) => x.id === id);
    if (!v) reasons.push(`Unknown variant ${id}`);
    else stage.push({ source: `variant:${id}`, ops: v.patch });
  }
  reasons.push(...checkConflicts(stage));
  if (reasons.length > 0) return { ok: false, reasons };
  const b = structuredClone(bundle);
  try {
    applyStage(b, stage, 'variant', []);
  } catch (e) {
    return { ok: false, reasons: [(e as Error).message] };
  }
  b.appliedVariantIds = sortedUnique([...bundle.appliedVariantIds, ...ids]);
  return { ok: true, bundle: b };
}

function hasExternalTransferOtherThan(b: ModelBundle, excluded: readonly string[]): boolean {
  const external = new Set(
    b.entities.filter((e) => e.kind === 'System' && e.boundary === 'external' && !excluded.includes(e.id)).map((e) => e.id),
  );
  const scan = (effects: { op: string; to?: string }[]): boolean => effects.some((e) => e.op === 'recordTransfer' && external.has(e.to!));
  return b.contracts.some((c) => scan(c.effects) || c.branches.some((br) => scan(br.effects)));
}

/** Effective automations: those whose actor bindings still hold after control patches. */
function effectiveAutomations(b: ModelBundle, requested: string[]): string[] {
  return requested.filter((id) => {
    const a = b.automations.find((x) => x.id === id);
    if (!a) return false;
    const actors = a.patch.filter((op): op is Extract<PatchOp, { op: 'setActor' }> => op.op === 'setActor');
    if (actors.length === 0) return true;
    return actors.every((op) => b.contracts.find((c) => c.id === op.id)?.actorId === op.actorId);
  });
}

export function compileDesign(bundle: ModelBundle, design: Design): CompileResult {
  const reasons: string[] = [];
  const automationIds = sortedUnique(design.automationIds);
  const controlIds = sortedUnique(design.controlIds);
  const automations: StagePatch[] = [];
  for (const id of automationIds) {
    const a = bundle.automations.find((x) => x.id === id);
    if (!a) reasons.push(`Unknown automation ${id}`);
    else automations.push({ source: id, ops: a.patch });
  }
  for (const id of controlIds) if (!bundle.repairs.some((x) => x.id === id)) reasons.push(`Unknown control ${id}`);
  reasons.push(...checkConflicts(automations));
  if (reasons.length > 0) return { ok: false, reasons };

  const b = structuredClone(bundle);
  const provenance: PatchProvenance[] = bundle.appliedVariantIds.map((id) => ({
    source: `variant:${id}`,
    stage: 'variant' as const,
    changed: true,
    summary: bundle.variants.find((v) => v.id === id)?.label ?? id,
  }));
  try {
    applyStage(b, automations, 'automation', provenance);
  } catch (e) {
    return { ok: false, reasons: [(e as Error).message] };
  }

  const appliedControlIds: string[] = [];
  const noopControlIds: string[] = [];
  const inapplicableControlIds: string[] = [];
  const controlStage: StagePatch[] = [];
  for (const id of controlIds) {
    const r = bundle.repairs.find((x) => x.id === id)!;
    const ext = r.applicability.requiresExternalTransferOtherThan;
    if (ext && !hasExternalTransferOtherThan(b, ext)) {
      inapplicableControlIds.push(id);
      provenance.push({ source: id, stage: 'control', changed: false, summary: 'inapplicable: no external transfer other than the approved gateway in this design' });
      continue;
    }
    controlStage.push({ source: id, ops: r.patch });
  }
  const controlConflicts = checkConflicts(controlStage);
  if (controlConflicts.length > 0) return { ok: false, reasons: controlConflicts };
  const before = provenance.length;
  try {
    applyStage(b, controlStage, 'control', provenance);
  } catch (e) {
    return { ok: false, reasons: [(e as Error).message] };
  }
  for (const p of provenance.slice(before)) (p.changed ? appliedControlIds : noopControlIds).push(p.source);

  const effective: EffectiveDesign = {
    requestedAutomationIds: automationIds,
    effectiveAutomationIds: effectiveAutomations(b, automationIds),
    requestedControlIds: controlIds,
    appliedControlIds,
    noopControlIds,
    inapplicableControlIds,
    variantIds: [...bundle.appliedVariantIds],
    provenance,
  };

  const model = index(b, effective);
  return { ok: true, model };
}

/** Compile an already-effective bundle without design patching (used by tests and tooling). */
export function index(b: ModelBundle, effective: EffectiveDesign): CompiledModel {
  const principals = new Map<string, PrincipalEntity>();
  const systems = new Map<string, SystemEntity>();
  const controls = new Map<string, ControlEntity>();
  for (const e of b.entities) {
    if (e.kind === 'Principal') principals.set(e.id, e);
    else if (e.kind === 'System') systems.set(e.id, e);
    else if (e.kind === 'Control') controls.set(e.id, e);
  }
  const contracts = [...b.contracts].sort((x, y) => (x.id < y.id ? -1 : 1));
  const grantKeys = new Set(b.capabilities.map((g: CapabilityGrant) => GRANT_KEY(g)));
  return {
    bundle: b,
    contracts,
    contractById: new Map(contracts.map((c) => [c.id, c])),
    principals,
    systems,
    controls,
    grantKeys,
    effective,
    semanticKey: semanticKeyOf(b),
  };
}

/**
 * Canonical semantic identity of an effective bundle: excludes display names, descriptions, source refs and
 * record order so that cosmetic edits and record permutations do not change it.
 */
export function semanticKeyOf(b: ModelBundle): string {
  const ents = b.entities
    .map((e) => {
      const { name: _n, description: _d, sourceRef: _s, summary: _sm, responsibilities: _r, ...rest } = e as unknown as Record<string, unknown>;
      return rest;
    })
    .sort((x, y) => String(x.id) < String(y.id) ? -1 : 1);
  const strip = <T extends { sourceRef?: string }>(xs: T[]) =>
    xs
      .map((x) => {
        const { sourceRef: _s, ...rest } = x as Record<string, unknown>;
        return rest;
      })
      .sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1));
  return canonicalJson({
    d: b.analysisDate,
    g: b.graphVersion,
    p: b.policyVersion,
    c: b.completeness,
    e: ents,
    k: strip(b.contracts),
    cap: b.capabilities.map((g) => GRANT_KEY(g)).sort(),
    auth: strip(b.authorization),
    pol: b.policies.map((p) => ({ id: p.id, params: p.params })).sort((x, y) => (x.id < y.id ? -1 : 1)),
    cases: strip(b.cases),
  });
}
