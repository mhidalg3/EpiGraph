import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyze, applyVariants, selectCases } from '../../src/engine';
import { compileDesign } from '../../src/engine/compile';
import { explainApproval, explainBeneficiary, independent } from '../../src/engine/evidence';
import { DEFAULT_LIMITS } from '../../src/model/schemas';
import type { AnalysisReport, EvidenceRecord, ExecutionState, ModelBundle, PaymentPayload } from '../../src/model/types';
import { freshBundle } from '../helpers';

const SEED = 20261006;
const DESIGNS = [
  { automationIds: [], controlIds: [] },
  { automationIds: ['A2'], controlIds: [] },
  { automationIds: ['A2', 'A3'], controlIds: [] },
  { automationIds: ['A2', 'A3'], controlIds: ['C2'] },
];

/** Normalized semantic outcome: statuses, hazards, per-case terminals and state counts; no labels or order. */
function sig(r: AnalysisReport, rename: (s: string) => string = (s) => s): string {
  return JSON.stringify({
    s: [r.analysisStatus, r.policyStatus, r.goalStatus],
    h: r.findings.map((f) => rename(f.id)).sort(),
    g: r.goalFailures.map((g) => rename(g.id)).sort(),
    c: r.cases.map((c) => [c.caseId, c.status, c.statesExplored, c.terminalDispositions]).sort(),
  });
}
function results(b: ModelBundle): string[] {
  const caseIds = b.suites.find((s) => s.id === 'flagship')!.caseIds;
  const sel = selectCases(b, caseIds);
  return DESIGNS.map((d) => sig(analyze(sel, d, caseIds, DEFAULT_LIMITS)));
}
const reference = results(freshBundle());

function shuffleBy<T>(xs: T[], keys: number[]): T[] {
  return xs.map((x, i) => [x, keys[i % keys.length]! + i * 1e-6] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x);
}

describe('invariance properties', () => {
  it('record permutations do not change the semantic result', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 5, maxLength: 12 }), (keys) => {
        const b = freshBundle();
        b.entities = shuffleBy(b.entities, keys);
        b.contracts = shuffleBy(b.contracts, keys.slice(1));
        b.capabilities = shuffleBy(b.capabilities, keys.slice(2));
        b.authorization = shuffleBy(b.authorization, keys.slice(3));
        b.cases = shuffleBy(b.cases, keys.slice(1));
        b.suites = shuffleBy(b.suites, keys);
        b.policies = shuffleBy(b.policies, keys.slice(2));
        for (const c of b.contracts) c.branches = shuffleBy(c.branches, keys.slice(1));
        expect(results(b)).toEqual(reference);
      }),
      { seed: SEED, numRuns: 12 },
    );
  });

  it('display labels and descriptions do not create hazards', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (label) => {
        const b = freshBundle();
        for (const e of b.entities) if ('name' in e) e.name = `${label}:${e.id}`;
        expect(results(b)).toEqual(reference);
      }),
      { seed: SEED, numRuns: 8 },
    );
  });

  it('consistent opaque renaming of principals, roles, systems and grants preserves results (modulo the mapping)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99999 }), (n) => {
        const b = freshBundle();
        const ids = b.entities.filter((e) => ['Principal', 'Role', 'System', 'OrgUnit'].includes(e.kind)).map((e) => e.id);
        const map = new Map(ids.map((id, i) => [id, `X${n}-${i}`]));
        const deep = (v: unknown): unknown => {
          if (typeof v === 'string') return map.get(v) ?? v;
          if (Array.isArray(v)) return v.map(deep);
          if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
          return v;
        };
        const renamed = deep(b) as ModelBundle;
        expect(results(renamed)).toEqual(reference);
      }),
      { seed: SEED, numRuns: 5 },
    );
  });

  it('harmless unreferenced graph facts do not change results', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (k) => {
        const b = freshBundle();
        for (let i = 0; i < k; i++) {
          b.entities.push({ id: `ORG-X${i}`, schemaVersion: '1.0.0', sourceRef: 'prop', evidenceStatus: 'fixture', kind: 'OrgUnit', name: 'Unused' });
          b.entities.push({ id: `ROLE-X${i}`, schemaVersion: '1.0.0', sourceRef: 'prop', evidenceStatus: 'fixture', kind: 'Role', name: 'Unused', responsibilities: [] });
          b.entities.push({ id: `P-X${i}`, schemaVersion: '1.0.0', sourceRef: 'prop', evidenceStatus: 'fixture', kind: 'Principal', name: 'Unused', principalKind: 'human', effectiveIdentityId: `ID-X${i}`, independenceGroup: `G-X${i}`, roleIds: [`ROLE-X${i}`] });
        }
        expect(results(b)).toEqual(reference);
      }),
      { seed: SEED, numRuns: 5 },
    );
  });

  it('applying a cosmetic variant does not change results', () => {
    const v = applyVariants(freshBundle(), ['V-COSMETIC-LABELS']);
    if (!v.ok) throw new Error('variant');
    expect(results(v.bundle)).toEqual(reference);
  });
});

// ---------- predicate-level properties ----------
const model = () => {
  const c = compileDesign(freshBundle(), { automationIds: [], controlIds: [] });
  if (!c.ok) throw new Error('compile');
  return c.model;
};
const m = model();
const ben = (o: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id: 'E1', kind: 'beneficiaryVerification', issuer: 'P-VERIFIER', subject: { supplierId: 'S1', bankVersion: 1, accountDigest: 'D1' },
  method: 'callback-trusted-directory', sources: ['SYS-DIRECTORY'], validFrom: '2026-01-01', validUntil: '2027-01-01', escalation: false, caseScope: 'C', provenance: 'issued', issuedBy: 't', ...o,
});
const state = (...evidence: EvidenceRecord[]): ExecutionState => ({ facts: {}, assets: {}, evidence });

describe('beneficiary evidence predicate', () => {
  const tuple = { supplierId: 'S1', bankVersion: 1, accountDigest: 'D1' };
  it('accepts exactly the matching scoped tuple from an independent authorized issuer', () => {
    expect(explainBeneficiary(m, state(ben()), 'C', tuple, 'P-MAINT').valid).toBe(true);
  });
  it('explains missing, wrong version/digest/supplier/case, untrusted source, expiry, authority and independence', () => {
    const why = (e: Partial<EvidenceRecord>, editor: string | null = 'P-MAINT') => explainBeneficiary(m, state(ben(e)), 'C', tuple, editor).reasons.join(' | ');
    expect(explainBeneficiary(m, state(), 'C', tuple, 'P-MAINT').reasons[0]).toMatch(/no beneficiary verification evidence exists/);
    expect(why({ subject: { supplierId: 'S1', bankVersion: 0, accountDigest: 'D1' } })).toMatch(/bank version 0, not v1/);
    expect(why({ subject: { supplierId: 'S1', bankVersion: 1, accountDigest: 'D2' } })).toMatch(/account digest D2, not D1/);
    expect(why({ subject: { supplierId: 'S2', bankVersion: 1, accountDigest: 'D1' } })).toMatch(/supplier S2, not S1/);
    expect(why({ caseScope: 'OTHER' })).toMatch(/belongs to case OTHER/);
    expect(why({ sources: ['SUPPLIER-REQUEST-PHONE'] })).toMatch(/not an approved independent source/);
    expect(why({ validUntil: '2026-10-01' })).toMatch(/expired on 2026-10-01/);
    expect(why({ validFrom: '2026-11-01' })).toMatch(/not yet valid/);
    expect(why({ issuer: 'P-APPROVER' })).toMatch(/not authorized to verify/);
    expect(why({}, 'P-VERIFIER')).toMatch(/same principal/);
    expect(why({}, null)).toMatch(/editor is unknown/);
  });
  it('never merges facts across evidence records', () => {
    const half1 = ben({ id: 'A', subject: { supplierId: 'S1', bankVersion: 0, accountDigest: 'D1' } });
    const half2 = ben({ id: 'B', subject: { supplierId: 'S1', bankVersion: 1, accountDigest: 'D2' } });
    expect(explainBeneficiary(m, state(half1, half2), 'C', tuple, 'P-MAINT').valid).toBe(false);
  });
  it('property: valid iff every tuple component and the case scope match', () => {
    fc.assert(
      fc.property(fc.record({ s: fc.constantFrom('S1', 'S2'), v: fc.integer({ min: 0, max: 3 }), d: fc.constantFrom('D1', 'D2'), c: fc.constantFrom('C', 'X') }), (x) => {
        const ev = ben({ subject: { supplierId: x.s, bankVersion: x.v, accountDigest: x.d }, caseScope: x.c });
        const expected = x.s === 'S1' && x.v === 1 && x.d === 'D1' && x.c === 'C';
        expect(explainBeneficiary(m, state(ev), 'C', tuple, 'P-MAINT').valid).toBe(expected);
      }),
      { seed: SEED, numRuns: 80 },
    );
  });
});

describe('independence', () => {
  it('property: independent iff distinct principal, distinct effective credential and distinct group', () => {
    fc.assert(
      fc.property(fc.constantFrom('a', 'b'), fc.constantFrom('g', 'h'), fc.constantFrom('a', 'b'), fc.constantFrom('g', 'h'), (ia, ga, ib, gb) => {
        const bundle = freshBundle();
        const p = (id: string) => bundle.entities.find((e) => e.id === id && e.kind === 'Principal');
        const x = p('P-APPROVER');
        const y = p('P-PAYOPS');
        if (x?.kind !== 'Principal' || y?.kind !== 'Principal') throw new Error('fixture');
        x.effectiveIdentityId = `ID-${ia}`;
        x.independenceGroup = `G-${ga}`;
        y.effectiveIdentityId = `ID-${ib}`;
        y.independenceGroup = `G-${gb}`;
        const c = compileDesign(bundle, { automationIds: [], controlIds: [] });
        if (!c.ok) throw new Error('compile');
        expect(independent(c.model, 'P-APPROVER', 'P-PAYOPS').ok).toBe(ia !== ib && ga !== gb);
      }),
      { seed: SEED, numRuns: 16 },
    );
  });
});

describe('approval binding', () => {
  const payload: PaymentPayload = { paymentId: 'PAY-1', paymentVersion: 1, invoiceId: 'INV-1', invoiceVersion: 1, supplierId: 'S1', bankVersion: 1, accountDigest: 'D1', amountCents: 100, currency: 'USD', obligationId: 'O', preparerId: 'P-PAYOPS' };
  const appr = (subject: Record<string, string | number>): EvidenceRecord => ({
    id: 'AP', kind: 'paymentAuthorization', issuer: 'P-APPROVER', subject: { ...payload, ...subject } as Record<string, string | number>, method: 'payment-approval', sources: ['SYS-APPROVAL'],
    validFrom: '2026-01-01', validUntil: '2027-01-01', escalation: false, caseScope: 'C', provenance: 'issued', issuedBy: 't',
  });
  it('a changed bound field never satisfies the predicate for the changed payload', () => {
    fc.assert(
      fc.property(fc.constantFrom('paymentVersion', 'bankVersion', 'accountDigest', 'amountCents', 'invoiceVersion', 'currency'), (field) => {
        const changed = typeof payload[field as keyof PaymentPayload] === 'number' ? { [field]: 999 } : { [field]: 'ZZZ' };
        expect(explainApproval(m, state(appr(changed)), 'C', payload).valid).toBe(false);
        expect(explainApproval(m, state(appr({})), 'C', payload).valid).toBe(true);
      }),
      { seed: SEED, numRuns: 12 },
    );
  });
});
