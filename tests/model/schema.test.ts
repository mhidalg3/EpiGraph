import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/engine';
import { economicsSchema } from '../../src/model/schemas';
import { MAX_IMPORT_BYTES, parseBundle } from '../../src/model/validate';
import { freshBundle } from '../helpers';
import { DEFAULT_LIMITS } from '../../src/model/schemas';

const asJson = () => JSON.parse(JSON.stringify(freshBundle()));

describe('bundled model', () => {
  it('validates and has the declared scope', () => {
    const b = freshBundle();
    expect(b.contracts.map((c) => c.id)).toEqual(['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12', 'W13', 'W14']);
    expect(b.automations.map((a) => a.id)).toEqual(['A1', 'A2', 'A3']);
    expect(b.repairs.map((a) => a.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    expect(b.policies.map((p) => p.id)).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06']);
    expect(new Set(b.entities.map((e) => e.kind))).toEqual(new Set(['OrgUnit', 'Principal', 'Role', 'System', 'Activity', 'Asset', 'Evidence', 'Control']));
    expect(b.analysisDate).toBe('2026-10-06');
    expect(b.entities.length).toBeLessThanOrEqual(100);
  });
});

describe('import rejection', () => {
  it('rejects oversized input before parsing', () => {
    const r = parseBundle(' '.repeat(MAX_IMPORT_BYTES + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons[0]).toMatch(/exceeds/);
  });
  it('rejects malformed JSON', () => {
    expect(parseBundle('{nope').ok).toBe(false);
  });
  it('rejects unknown schema keys and unsupported schema versions', () => {
    const a = asJson();
    a.surprise = 1;
    expect(parseBundle(a).ok).toBe(false);
    const b = asJson();
    b.schemaVersion = '9.9.9';
    expect(parseBundle(b).ok).toBe(false);
  });
  it('rejects more than 100 entities and more than 150 projected relations', () => {
    const many = asJson();
    for (let i = 0; i < 41; i++) many.entities.push({ id: `ORG-X${i}`, schemaVersion: '1.0.0', sourceRef: 't', evidenceStatus: 'fixture', kind: 'OrgUnit', name: 'x' });
    expect(parseBundle(many).ok).toBe(false);
    const dense = asJson();
    const roleIds = dense.entities.filter((e: { kind: string }) => e.kind === 'Role').map((e: { id: string }) => e.id);
    for (let i = 0; i < 10; i++)
      dense.entities.push({ id: `P-X${i}`, schemaVersion: '1.0.0', sourceRef: 't', evidenceStatus: 'fixture', kind: 'Principal', name: 'x', principalKind: 'human', effectiveIdentityId: `ID-X${i}`, independenceGroup: `G-X${i}`, roleIds: roleIds.slice(0, 8) });
    const r = parseBundle(dense);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join()).toMatch(/projected relations/);
  });
  it('rejects prototype/reserved fact keys and imported appliedVariantIds that mask dangling grant removals', () => {
    const proto = asJson();
    proto.cases[0].initialFacts['__proto__'] = 1;
    const parsedProto = parseBundle(JSON.stringify(proto).replace('"initialFacts":{', '"initialFacts":{"__proto__":1,'));
    // either rejected or the reserved key is dropped by the schema: it can never reach the state object
    if (parsedProto.ok) expect(Object.prototype.hasOwnProperty.call(parsedProto.bundle.cases[0]!.initialFacts, '__proto__')).toBe(false);
    const sep = asJson();
    sep.cases[0].initialFacts['a;b=c'] = 1;
    expect(parseBundle(sep).ok).toBe(false);
    const typo = asJson();
    typo.appliedVariantIds = ['V-NO-C3'];
    typo.repairs[0].patch.push({ op: 'removeCapability', grantId: 'G-TYPO' });
    const r = parseBundle(typo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join()).toMatch(/unknown grant G-TYPO/);
  });
  it('rejects credential-shaped fields', () => {
    const a = asJson();
    a.entities[0].apiKey = 'x';
    const r = parseBundle(a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join()).toMatch(/Credential-shaped/);
  });
  it('rejects unsupported operations and arbitrary executable expressions', () => {
    const a = asJson();
    a.contracts[0].operation = 'eval';
    expect(parseBundle(a).ok).toBe(false);
    const b = asJson();
    b.contracts[0].workflowPreconditions = { op: 'js', code: 'process.exit()' };
    expect(parseBundle(b).ok).toBe(false);
  });
  it('rejects duplicate ids, dangling references and unsupported currency', () => {
    const dup = asJson();
    dup.entities.push({ ...dup.entities[0] });
    expect(parseBundle(dup).ok).toBe(false);
    const dangling = asJson();
    dangling.contracts[2].actorId = 'P-NOBODY';
    expect(parseBundle(dangling).ok).toBe(false);
    const eur = asJson();
    eur.cases[0].initialAssets.find((x: { kind: string }) => x.kind === 'invoice').fields.find((f: { name: string }) => f.name === 'currency').value = 'EUR';
    expect(parseBundle(eur).ok).toBe(false);
  });
  it('rejects malformed initial evidence subjects (invalid input) but admits stale evidence (valid scenario)', () => {
    const bad = asJson();
    const c = bad.cases.find((x: { id: string }) => x.id === 'CASE-ROUTINE');
    delete c.initialEvidence[0].subject.accountDigest;
    expect(parseBundle(bad).ok).toBe(false);
    const stale = asJson();
    stale.cases.find((x: { id: string }) => x.id === 'CASE-ROUTINE').initialEvidence[0].validUntil = '2026-01-20';
    expect(parseBundle(stale).ok).toBe(true);
  });
  it('rejects attestation issuance by non-attesting operations', () => {
    const a = asJson();
    const w06 = a.contracts.find((c: { id: string }) => c.id === 'W06');
    w06.effects.push({ op: 'issueEvidence', kind: 'beneficiaryVerification', subject: 'draft', method: { ref: 'lit', value: 'x' }, sources: [], validDays: 5 });
    const r = parseBundle(a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join()).toMatch(/may not issue attestations/);
  });
  it('enforces the paid-supplier-event bound on economics', () => {
    const e = freshBundle().economics;
    expect(economicsSchema.safeParse({ ...e, monthly: { ...e.monthly, paidSupplierEvents: 101 } }).success).toBe(false);
    expect(economicsSchema.safeParse({ ...e, monthly: { ...e.monthly, paidSupplierEvents: -1 } }).success).toBe(false);
    expect(economicsSchema.safeParse({ ...e, monthly: { ...e.monthly, paidSupplierEvents: 100 } }).success).toBe(true);
  });
});

describe('invalid / unknown representations', () => {
  it('reports malformed models as invalid/unknown/unknown, never as a pass', () => {
    const b = freshBundle();
    b.contracts[2]!.actorId = 'P-NOBODY';
    const r = analyze(b, { automationIds: [], controlIds: [] }, ['CASE-ROUTINE'], DEFAULT_LIMITS);
    expect([r.analysisStatus, r.policyStatus, r.goalStatus]).toEqual(['invalid', 'unknown', 'unknown']);
    expect(r.invalidReasons.length).toBeGreaterThan(0);
  });
  it('treats empty or unknown case selections as invalid', () => {
    const b = freshBundle();
    expect(analyze(b, { automationIds: [], controlIds: [] }, [], DEFAULT_LIMITS).analysisStatus).toBe('invalid');
    expect(analyze(b, { automationIds: [], controlIds: [] }, ['CASE-NOPE'], DEFAULT_LIMITS).analysisStatus).toBe('invalid');
  });
  it('rejects unknown automation or control ids and conflicting assignments', () => {
    const b = freshBundle();
    expect(analyze(b, { automationIds: ['A9'], controlIds: [] }, ['CASE-ROUTINE'], DEFAULT_LIMITS).analysisStatus).toBe('invalid');
    const conflict = freshBundle();
    conflict.automations[0]!.patch.push({ op: 'setActor', id: 'W06', actorId: 'P-PAYOPS' });
    conflict.automations[1]!.patch.push({ op: 'setActor', id: 'W06', actorId: 'P-APPROVER' });
    const r = analyze(conflict, { automationIds: ['A1', 'A2'], controlIds: [] }, ['CASE-ROUTINE'], DEFAULT_LIMITS);
    expect(r.analysisStatus).toBe('invalid');
    expect(r.invalidReasons.join()).toMatch(/Conflicting patch/);
  });
});
