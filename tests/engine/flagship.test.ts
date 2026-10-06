import { describe, expect, it } from 'vitest';
import { analyzeComposition, compare, replayWitness } from '../../src/engine';
import { DEFAULT_LIMITS } from '../../src/model/schemas';
import type { Witness } from '../../src/model/types';
import { hazards, prepared, run } from '../helpers';

const ALL = ['A1', 'A2', 'A3'];
const subsets: string[][] = [[], ['A1'], ['A2'], ['A3'], ['A1', 'A2'], ['A1', 'A3'], ['A2', 'A3'], ALL];

describe('baseline', () => {
  const r = run();
  it('completes with every policy satisfied and goals satisfied', () => {
    expect(r.analysisStatus).toBe('complete');
    expect(r.policyStatus).toBe('satisfied_in_model');
    expect(r.goalStatus).toBe('satisfied');
    expect(r.policies.map((p) => p.status)).toEqual(Array(6).fill('satisfied_in_model'));
  });
  it('ends legitimate cases in exactly one reconciled payment and the invalid change in the specific hold', () => {
    const by = Object.fromEntries(r.cases.map((c) => [c.caseId, c.terminalDispositions]));
    expect(by['CASE-ROUTINE']).toEqual({ reconciled: 1 });
    expect(by['CASE-NEW-VALID']).toEqual({ reconciled: 1 });
    expect(Object.keys(by['CASE-CHANGE-INVALID']!)).toEqual(['held:beneficiary_verification_failed']);
    expect(r.cases.every((c) => c.deadlocks === 0)).toBe(true);
  });
});

describe('flagship: all eight automation subsets', () => {
  const unsafe = new Set(['A2+A3', 'A1+A2+A3']);
  for (const s of subsets) {
    const name = s.join('+') || 'none';
    it(`${name}: ${unsafe.has(name) ? 'P01 reachable' : 'policies and goals satisfied'}`, () => {
      const r = run({ automations: s });
      expect(r.analysisStatus).toBe('complete');
      if (unsafe.has(name)) {
        expect(r.policyStatus).toBe('violated');
        expect(r.policies.find((p) => p.policyId === 'P01')!.status).toBe('violated');
        expect(r.policies.filter((p) => p.policyId !== 'P01').every((p) => p.status === 'satisfied_in_model')).toBe(true);
      } else {
        expect(r.policyStatus).toBe('satisfied_in_model');
        expect(r.goalStatus).toBe('satisfied');
      }
    });
  }
});

describe('A2 + A3 witness', () => {
  const r = run({ automations: ['A2', 'A3'] });
  const f = r.findings.find((x) => x.id === 'P01|unverified-destination|CASE-NEW-VALID')!;
  it('executes to an unverified destination although an independent exact approval was issued', () => {
    const events = f.witness.steps.flatMap((s) => s.events);
    const approval = events.find((e) => e.kind === 'evidenceIssued' && e.evidence.kind === 'paymentAuthorization');
    expect(approval).toBeDefined();
    if (approval?.kind === 'evidenceIssued') expect(approval.actorId).toBe('P-APPROVER');
    expect(f.witness.steps.some((s) => s.transitionId.startsWith('W03:') || s.transitionId.startsWith('W09:'))).toBe(false);
    const last = f.witness.steps.at(-1)!;
    expect(last.activityId).toBe('W11');
    expect(last.actorId).toBe('SVC-PAYMENT');
    expect(f.witness.steps.find((s) => s.activityId === 'W04')?.actorId).toBe('SVC-SUPPLIER');
    expect(f.witness.violation.reasons.join()).toMatch(/no beneficiary verification evidence exists for \(SUP-1, v1, D1\)/);
  });
  it('names the enabling patches and the retained safeguard that does not verify the beneficiary', () => {
    expect(f.enablingPatches).toEqual(['A2', 'A3']);
    expect(f.retainedSafeguards.join(' ')).toMatch(/W10.*not the authenticity/);
  });
  it('the other policies stay satisfied (the approval is valid and bound)', () => {
    expect(hazards(r).every((h) => h.startsWith('P01|'))).toBe(true);
  });
  it('replays and re-confirms the violation; tampered witnesses are rejected', () => {
    const { bundle } = prepared({ suite: 'flagship' });
    const design = { automationIds: ['A2', 'A3'], controlIds: [] };
    const ok = replayWitness(bundle, design, f.witness);
    expect(ok.status).toBe('verified');
    expect(ok.violation?.policyId).toBe('P01');

    const wrongStep: Witness = structuredClone(f.witness);
    wrongStep.steps[3]!.transitionId = 'W03:verified';
    expect(replayWitness(bundle, design, wrongStep).status).toBe('rejected');

    const tuple: Witness = structuredClone(f.witness);
    const exec = tuple.steps.at(-1)!.events.find((e) => e.kind === 'paymentExecuted');
    if (exec?.kind === 'paymentExecuted') exec.payload.accountDigest = 'D-FORGED';
    expect(replayWitness(bundle, design, tuple).status).toBe('rejected');

    expect(replayWitness(bundle, { automationIds: [], controlIds: [] }, f.witness).status).toBe('rejected');
  });
  it('the same witness does not reproduce under the repaired design', () => {
    const { bundle } = prepared({ suite: 'flagship' });
    expect(replayWitness(bundle, { automationIds: ['A2', 'A3'], controlIds: ['C2'] }, f.witness).status).toBe('rejected');
  });
});

describe('repairs of the flagship hazard', () => {
  it('C2: valid change reconciles once, invalid change is held, and both gateway entries enforce it', () => {
    const r = run({ automations: ['A2', 'A3'], controls: ['C2'] });
    expect([r.analysisStatus, r.policyStatus, r.goalStatus]).toEqual(['complete', 'satisfied_in_model', 'satisfied']);
    const by = Object.fromEntries(r.cases.map((c) => [c.caseId, c.terminalDispositions]));
    expect(by['CASE-NEW-VALID']).toEqual({ reconciled: 1 });
    expect(Object.keys(by['CASE-CHANGE-INVALID']!)).toEqual(['held:beneficiary_verification_failed']);
    const { bundle } = prepared({ suite: 'flagship' });
    const c2 = bundle.repairs.find((x) => x.id === 'C2')!;
    expect(c2.patch.filter((o) => o.op === 'addControl').map((o) => (o.op === 'addControl' ? o.id : ''))).toEqual(['W11', 'W14']);
  });
  it('C1 restores precommit verification; C5 removes the agent write capability and its benefit', () => {
    for (const control of ['C1', 'C5']) {
      const r = run({ automations: ['A2', 'A3'], controls: [control] });
      expect([r.policyStatus, r.goalStatus]).toEqual(['satisfied_in_model', 'satisfied']);
    }
    const r5 = run({ automations: ['A2', 'A3'], controls: ['C5'] });
    expect(r5.effective.requestedAutomationIds).toEqual(['A2', 'A3']);
    expect(r5.effective.effectiveAutomationIds).toEqual(['A3']);
    const r1 = run({ automations: ['A2', 'A3'], controls: ['C1'] });
    expect(r1.effective.effectiveAutomationIds).toEqual(['A2', 'A3']);
  });
  it('C1 and C2 may coexist', () => {
    const r = run({ automations: ['A2', 'A3'], controls: ['C1', 'C2'] });
    expect(r.policyStatus).toBe('satisfied_in_model');
    expect(r.goalStatus).toBe('satisfied');
  });
});

describe('composition', () => {
  const { bundle } = prepared({ suite: 'flagship' });
  const comp = analyzeComposition(bundle, ALL, bundle.suites.find((s) => s.id === 'flagship')!.caseIds, DEFAULT_LIMITS);
  it('analyzes all eight subsets with identical cases', () => {
    expect(comp.subsets.map((s) => s.automationIds.join('+') || 'none')).toEqual(['none', 'A1', 'A2', 'A3', 'A1+A2', 'A1+A3', 'A2+A3', 'A1+A2+A3']);
    expect(comp.subsets.filter((s) => s.policyStatus === 'violated').map((s) => s.automationIds.join('+'))).toEqual(['A2+A3', 'A1+A2+A3']);
  });
  it('discovers {A2,A3} as the inclusion-minimal enabling set for the P01 hazards', () => {
    const p01 = comp.hazards.filter((h) => h.policyId === 'P01');
    expect(p01.length).toBeGreaterThan(0);
    for (const h of p01) {
      expect(h.status).toBe('established');
      expect(h.minimalSets).toEqual([['A2', 'A3']]);
      expect(h.reachableIn).toEqual([['A2', 'A3'], ['A1', 'A2', 'A3']]);
    }
  });
  it('does not claim minimality when a proper subset is incomplete', () => {
    const partial = analyzeComposition(bundle, ALL, bundle.suites.find((s) => s.id === 'flagship')!.caseIds, { ...DEFAULT_LIMITS, maxStatesPerCase: 12, maxTransitionsPerCase: 250000, maxDesigns: 512 });
    expect(partial.analysisStatus).toBe('partial');
    for (const h of partial.hazards) expect(h.status === 'established' && h.minimalSets.length > 0).toBe(h.status === 'established');
    expect(partial.hazards.every((h) => h.status === 'unknown' || h.unknownSubsets.length === 0)).toBe(true);
  });
});

describe('differential', () => {
  const { bundle, caseIds } = prepared({ suite: 'flagship' });
  it('reports introduced P01 findings and a new unverified execution atom for A2+A3 against the manual baseline', () => {
    const d = compare(bundle, { automationIds: [], controlIds: [] }, { automationIds: ['A2', 'A3'], controlIds: [] }, caseIds, DEFAULT_LIMITS);
    expect(d.findings.introduced.map((f) => f.policyId)).toEqual(['P01', 'P01']);
    expect(d.findings.persistent).toEqual([]);
    expect(d.atoms.introduced.some((a) => a.destination === 'payment.execute' && a.evidence.includes('beneficiaryEvidence=missing-or-invalid'))).toBe(true);
    expect(d.atoms.introduced.find((a) => a.destination === 'payment.execute')?.source).toBe('supplier-claim:bank');
    // the baseline's verified supplier-claim -> payment flow no longer exists in the candidate
    expect(d.atoms.removed.some((a) => a.destination === 'payment.execute' && a.source === 'supplier-claim:bank' && a.evidence.includes('beneficiaryEvidence=valid'))).toBe(true);
  });
  it('A2 alone introduces no new unverified-execution atom (retained W09)', () => {
    const d = compare(bundle, { automationIds: [], controlIds: [] }, { automationIds: ['A2'], controlIds: [] }, caseIds, DEFAULT_LIMITS);
    expect(d.findings.introduced).toEqual([]);
    expect(d.atoms.introduced.some((a) => a.evidence.includes('missing-or-invalid') && a.destination === 'payment.execute')).toBe(false);
  });
  it('an unsafe baseline compared with itself or a cosmetic variant is persistent, not clean', () => {
    const u = prepared({ suite: 'flagship', variants: ['V-UNSAFE-BASELINE'] });
    const same = compare(u.bundle, { automationIds: [], controlIds: [] }, { automationIds: [], controlIds: [] }, u.caseIds, DEFAULT_LIMITS);
    expect(same.findings.persistent.length).toBeGreaterThan(0);
    expect(same.findings.introduced).toEqual([]);
    expect(same.baseline.policyStatus).toBe('violated');
    const cosmetic = prepared({ suite: 'flagship', variants: ['V-UNSAFE-BASELINE', 'V-COSMETIC-LABELS'] });
    const d = compare(cosmetic.bundle, { automationIds: [], controlIds: [] }, { automationIds: [], controlIds: [] }, cosmetic.caseIds, DEFAULT_LIMITS);
    expect(d.findings.persistent.length).toBe(same.findings.persistent.length);
    expect(d.findings.introduced).toEqual([]);
  });
  it('a repaired candidate resolves the findings', () => {
    const d = compare(bundle, { automationIds: ['A2', 'A3'], controlIds: [] }, { automationIds: ['A2', 'A3'], controlIds: ['C2'] }, caseIds, DEFAULT_LIMITS);
    expect(d.findings.resolved.length).toBe(2);
    expect(d.completeForRemoval).toBe(true);
  });
});
