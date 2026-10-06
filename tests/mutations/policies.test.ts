import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../../src/model/schemas';
import { hazards, run } from '../helpers';

const dispositions = (r: ReturnType<typeof run>, id: string) => r.cases.find((c) => c.caseId === id)!.terminalDispositions;

describe('P02: bound, independent approval', () => {
  it('baseline (C3 present) completes every stale-approval interleaving with reapproval', () => {
    const r = run({ suite: 'stale-approval' });
    expect(r.policyStatus).toBe('satisfied_in_model');
    expect(r.goalStatus).toBe('satisfied');
    expect(Object.keys(dispositions(r, 'CASE-STALE-UPDATE'))).toEqual(['reconciled']);
  });
  it('without C3 binding a post-approval bank-version change makes P02 reachable while P01 stays satisfied', () => {
    const r = run({ suite: 'stale-approval', variants: ['V-NO-C3'] });
    expect(hazards(r)).toEqual(['P02|unbound-or-dependent-approval|CASE-STALE-UPDATE']);
    const f = r.findings[0]!;
    expect(f.witness.violation.reasons.join()).toMatch(/binds bankVersion=0, executed payload has 1/);
    // old approval stays in audit history: both authorizations are visible, the stale one never satisfies the new tuple
    expect(f.witness.steps.flatMap((s) => s.events).filter((e) => e.kind === 'evidenceIssued' && e.evidence.kind === 'paymentAuthorization').length).toBe(1);
  });
  it('reapplying C3 requires new preparation/approval and all legitimate executions complete', () => {
    const r = run({ suite: 'stale-approval', variants: ['V-NO-C3'], controls: ['C3'] });
    expect(r.policyStatus).toBe('satisfied_in_model');
    expect(r.goalStatus).toBe('satisfied');
    expect(r.effective.appliedControlIds).toEqual(['C3']);
  });
  it('a shared effective credential or shared independence group defeats approver independence', () => {
    for (const v of ['V-APPROVER-ALIAS', 'V-SHARED-GROUP']) {
      const r = run({ variants: [v], cases: ['CASE-ROUTINE'] });
      expect(hazards(r, 'P02').sort()).toEqual(['P02|dependent-approval-issued|CASE-ROUTINE', 'P02|unbound-or-dependent-approval|CASE-ROUTINE']);
    }
  });
});

describe('P03: authorized operation (ability vs authorization vs enforcement)', () => {
  it('a technical grant with a normative deny stays feasible and is reported', () => {
    const r = run({ variants: ['V-NORMATIVE-DENY-PAYMENT-AGENT'], automations: ['A3'], cases: ['CASE-ROUTINE'] });
    expect(hazards(r)).toEqual(['P03|unauthorized:execute:gateway:payment|CASE-ROUTINE']);
    expect(dispositions(r, 'CASE-ROUTINE')).toEqual({ reconciled: 1 });
  });
  it('removing the exact grant from a complete inventory disables the transition, invents no grant and fails the goal', () => {
    const r = run({ variants: ['V-NO-PAYMENT-CAPABILITY'] });
    expect(r.policyStatus).toBe('satisfied_in_model');
    expect(r.goalStatus).toBe('failed');
    expect(r.goalFailures.map((g) => g.kind)).toEqual(['deadlock', 'deadlock']);
  });
  it('is not triggered by department or role labels alone', () => {
    expect(hazards(run(), 'P03')).toEqual([]);
    expect(hazards(run({ automations: ['A1', 'A2', 'A3'], controls: ['C2'] }), 'P03')).toEqual([]);
  });
  it('reports technical capability excess separately from witnessed findings', () => {
    const r = run({ automations: ['A2'] });
    expect(r.capabilityNotices.some((n) => n.grantId === 'G-SVCSUP-DIRECTORY-READ')).toBe(true);
    expect(r.findings).toEqual([]);
  });
});

describe('P04: restricted-data transfer', () => {
  it('an internal extractor causes no boundary transfer finding', () => {
    expect(run({ suite: 'external-transfer', automations: ['A1'] }).policyStatus).toBe('satisfied_in_model');
  });
  it('raw restricted fields and a restricted-derived summary to an external extractor violate P04', () => {
    const r = run({ suite: 'external-transfer', automations: ['A1'], variants: ['V-EXTERNAL-EXTRACTOR'] });
    expect(hazards(r).sort()).toEqual(['P04|restricted-transfer:SYS-EXTRACTOR|CASE-EXT-RAW', 'P04|restricted-transfer:SYS-EXTRACTOR|CASE-EXT-SUMMARY']);
    const raw = r.findings.find((f) => f.caseId === 'CASE-EXT-RAW')!;
    expect(raw.witness.violation.reasons.join()).toMatch(/remitBankAccount/);
    const summary = r.findings.find((f) => f.caseId === 'CASE-EXT-SUMMARY')!;
    expect(summary.witness.violation.reasons.join()).toMatch(/summaryText has no permitted purpose left/);
  });
  it('C4 projects restricted and restricted-derived fields, preserves completion, and is inapplicable without external extraction', () => {
    const r = run({ suite: 'external-transfer', automations: ['A1'], variants: ['V-EXTERNAL-EXTRACTOR'], controls: ['C4'] });
    expect([r.policyStatus, r.goalStatus]).toEqual(['satisfied_in_model', 'satisfied']);
    const sent = r.cases.map((c) => c.terminalDispositions);
    expect(sent).toEqual([{ reconciled: 1 }, { reconciled: 1 }]);
    const inert = run({ suite: 'external-transfer', automations: ['A1'], controls: ['C4'] });
    expect(inert.effective.inapplicableControlIds).toEqual(['C4']);
    expect(inert.effective.appliedControlIds).toEqual([]);
  });
});

describe('P05: business prerequisites (the named mutant removes the operational guard)', () => {
  it('unmutated guards hold with explicit reasons', () => {
    const r = run({ suite: 'assurance-boundaries', automations: ['A1'] });
    expect(dispositions(r, 'CASE-UNCLEARED')).toEqual({ 'held:onboarding_not_cleared': 12 });
    expect(dispositions(r, 'CASE-INVOICE-MISMATCH')).toEqual({ 'held:invoice_mismatch': 1 });
    expect(dispositions(r, 'CASE-EXTRACTION-MISMATCH')).toEqual({ 'held:invoice_mismatch': 1 });
    expect(dispositions(r, 'CASE-LIMIT-OVER')).toEqual({ 'held:escalation_required': 1 });
    expect(r.policyStatus).toBe('satisfied_in_model');
    expect(r.goalStatus).toBe('satisfied');
  });
  it('exactly USD 10,000.00 is routine; USD 10,000.01 needs admitted escalation', () => {
    const r = run({ suite: 'assurance-boundaries' });
    expect(dispositions(r, 'CASE-LIMIT-EXACT')).toEqual({ reconciled: 1 });
    expect(dispositions(r, 'CASE-LIMIT-OVER-ESCALATED')).toEqual({ reconciled: 1 });
    expect(dispositions(r, 'CASE-LIMIT-OVER')).toEqual({ 'held:escalation_required': 1 });
  });
  it('mutants without the clearance / match / limit guard reach an actual P05 witness', () => {
    expect(hazards(run({ suite: 'assurance-boundaries', variants: ['V-NO-CLEARANCE-GATE'], cases: ['CASE-UNCLEARED'] }))).toEqual(['P05|missing-clearance|CASE-UNCLEARED']);
    expect(hazards(run({ suite: 'assurance-boundaries', variants: ['V-NO-MATCH-GATE'], cases: ['CASE-INVOICE-MISMATCH'] }))).toEqual(['P05|unmatched-invoice|CASE-INVOICE-MISMATCH']);
    expect(hazards(run({ suite: 'assurance-boundaries', variants: ['V-NO-LIMIT-GATE'], cases: ['CASE-LIMIT-OVER', 'CASE-LIMIT-EXACT'] }))).toEqual(['P05|limit-exceeded-without-escalation|CASE-LIMIT-OVER']);
  });
});

describe('P06: at-most-once settlement', () => {
  it('with C6 a settled-but-unacknowledged retry returns the prior receipt and reconciles once', () => {
    const r = run({ suite: 'uncertain-retry' });
    expect([r.policyStatus, r.goalStatus]).toEqual(['satisfied_in_model', 'satisfied']);
    const w = r.cases[0]!.terminalDispositions;
    expect(w).toEqual({ reconciled: 2 });
  });
  it('without C6 the retry settles twice (P06) and C6 repairs it', () => {
    const bad = run({ suite: 'uncertain-retry', variants: ['V-NO-C6'] });
    expect(hazards(bad, 'P06')).toEqual(['P06|second-settlement|CASE-RETRY-UNCERTAIN']);
    expect(bad.goalFailures.some((g) => g.kind === 'second_settlement')).toBe(true);
    const fixed = run({ suite: 'uncertain-retry', variants: ['V-NO-C6'], controls: ['C6'] });
    expect([fixed.policyStatus, fixed.goalStatus]).toEqual(['satisfied_in_model', 'satisfied']);
  });
  it('the already-present C3/C6 are true no-ops', () => {
    const r = run({ controls: ['C3', 'C6'] });
    expect(r.effective.noopControlIds).toEqual(['C3', 'C6']);
    expect(r.effective.appliedControlIds).toEqual([]);
  });
});

describe('P01 evidence defects with the release-time check removed (A3)', () => {
  const r = run({ suite: 'assurance-boundaries', automations: ['A3'] });
  const reasons = (c: string) => r.findings.find((f) => f.caseId === c)!.witness.violation.reasons.join(' ');
  it('expired / wrong digest / wrong version / wrong supplier / wrong case / untrusted source each fail with their own reason', () => {
    expect(reasons('CASE-EXPIRED-EVIDENCE')).toMatch(/expired on 2026-09-30/);
    expect(reasons('CASE-WRONG-DIGEST-EVIDENCE')).toMatch(/account digest D8, not D0/);
    expect(reasons('CASE-WRONG-VERSION-EVIDENCE')).toMatch(/bank version 7, not v0/);
    expect(reasons('CASE-WRONG-SUPPLIER-EVIDENCE')).toMatch(/supplier SUP-2, not SUP-1/);
    expect(reasons('CASE-WRONG-CASE-EVIDENCE')).toMatch(/belongs to case CASE-OTHER/);
    expect(reasons('CASE-UNTRUSTED-EVIDENCE')).toMatch(/method callback-supplied-number is not admitted/);
  });
  it('the manual W09 retains safety for every one of those cases by obtaining fresh independent evidence', () => {
    const b = run({ suite: 'assurance-boundaries' });
    expect(hazards(b, 'P01')).toEqual([]);
  });
});

describe('business goals', () => {
  it('holding every invoice is policy-safe but fails the goal', () => {
    const r = run({ variants: ['V-HOLD-ALL'] });
    expect(r.policyStatus).toBe('satisfied_in_model');
    expect(r.goalStatus).toBe('failed');
  });
  it('an unsafe baseline is persistent and reported violated', () => {
    const r = run({ variants: ['V-UNSAFE-BASELINE'] });
    expect(r.policyStatus).toBe('violated');
  });
});

describe('unknown / partial assurance', () => {
  it('unknown capability inventory or control implementation returns partial/unknown/unknown without exploring', () => {
    for (const v of ['V-UNKNOWN-CAPABILITIES', 'V-UNKNOWN-CONTROL']) {
      const r = run({ variants: [v] });
      expect([r.analysisStatus, r.policyStatus, r.goalStatus]).toEqual(['partial', 'unknown', 'unknown']);
      expect(r.totals.states).toBe(0);
      expect(r.incompleteReasons.length).toBeGreaterThan(0);
    }
  });
  it('maxStatesPerCase: 1 and a tiny transition cap are partial: absence of a witness is unknown, never a pass', () => {
    for (const limits of [{ ...DEFAULT_LIMITS, maxStatesPerCase: 1 }, { ...DEFAULT_LIMITS, maxTransitionsPerCase: 3 }]) {
      const r = run({ limits });
      expect(r.analysisStatus).toBe('partial');
      expect(r.policyStatus).toBe('unknown');
      expect(r.goalStatus).toBe('unknown');
      expect(r.policies.some((p) => p.status === 'satisfied_in_model')).toBe(false);
    }
  });
  it('a witness found before truncation stays violated although coverage is partial', () => {
    const found: number[] = [];
    for (let cap = 1; cap <= 30; cap++) {
      const r = run({ automations: ['A2', 'A3'], cases: ['CASE-NEW-VALID'], limits: { ...DEFAULT_LIMITS, maxStatesPerCase: cap } });
      if (r.analysisStatus === 'partial') {
        expect(r.policyStatus === 'violated' || r.policyStatus === 'unknown').toBe(true);
        if (r.findings.length > 0) {
          expect(r.policyStatus).toBe('violated');
          found.push(cap);
        }
      }
    }
    expect(found.length).toBeGreaterThan(0);
  });
});
