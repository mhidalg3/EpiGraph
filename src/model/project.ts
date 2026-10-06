import type { ModelBundle } from './schemas';

export interface ProjectedRelation {
  kind: string;
  from: string;
  to: string;
  detail: string;
}

/** Display/limit projection of the typed relationships, derived from the canonical bundle (never stored separately). */
export function projectRelations(b: ModelBundle): ProjectedRelation[] {
  const out: ProjectedRelation[] = [];
  for (const e of b.entities) {
    if (e.kind === 'Activity') out.push({ kind: 'ACCOUNTABLE_FOR', from: e.ownerOrgUnitId, to: e.id, detail: '' });
    if (e.kind === 'Principal') for (const r of e.roleIds) out.push({ kind: 'HAS_ROLE', from: e.id, to: r, detail: '' });
  }
  for (const g of b.capabilities)
    out.push({ kind: 'CAN_CALL', from: g.principalId, to: g.system, detail: `${g.operation}:${g.resource}` });
  for (const c of b.contracts) {
    out.push({ kind: 'EXECUTES', from: c.actorId, to: c.id, detail: c.operation });
    for (const i of c.inputs) out.push({ kind: 'CONSUMES', from: i.asset.kind, to: c.id, detail: i.role });
    for (const ctl of c.implementedControlIds) out.push({ kind: 'GUARDS', from: ctl, to: c.id, detail: '' });
    const effects = [...c.effects, ...c.branches.flatMap((br) => br.effects)];
    const seen = new Set<string>();
    for (const f of effects) {
      let rel: ProjectedRelation | null = null;
      if (f.op === 'createAsset') rel = { kind: 'PRODUCES', from: c.id, to: f.kind, detail: '' };
      else if (f.op === 'recordTransfer') rel = { kind: 'TRANSFERS_TO', from: c.id, to: f.to, detail: f.purpose };
      else if (f.op === 'issueEvidence') rel = { kind: 'ATTESTS_TO', from: f.kind, to: c.id, detail: f.subject };
      if (rel && !seen.has(rel.kind + rel.to)) {
        seen.add(rel.kind + rel.to);
        out.push(rel);
      }
    }
  }
  return out;
}
