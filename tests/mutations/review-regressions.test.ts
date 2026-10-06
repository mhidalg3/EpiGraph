import { describe, expect, it } from 'vitest';
import { analyze, replayWitness, selectCases } from '../../src/engine';
import { DEFAULT_LIMITS } from '../../src/model/schemas';
import type { Witness } from '../../src/model/types';
import { hazards, prepared, run } from '../helpers';

describe('C2 never creates a dead end', () => {
  it('C2 with a retained manual W09 re-opens verification when the bank version changes after W09 ran', () => {
    for (const automations of [['A2'], ['A1', 'A2']]) {
      const r = run({ suite: 'stale-approval', automations, controls: ['C2'] });
      expect([r.analysisStatus, r.policyStatus, r.goalStatus]).toEqual(['complete', 'satisfied_in_model', 'satisfied']);
      expect(r.cases[0]!.deadlocks).toBe(0);
    }
  });
});

describe('field-scoped deny overrides a broader allow', () => {
  it('a deny on one touched field fires even when the event also touches other fields', () => {
    const r = run({
      cases: ['CASE-NEW-VALID'],
      mutate: (b) => {
        b.authorization.push({
          id: 'R-DENY-TAXID', schemaVersion: '1.0.0', sourceRef: 't', evidenceStatus: 'fixture', effect: 'deny', principalIds: [], roleIds: ['ROLE-SUPPLIER-MAINTAINER'],
          operations: ['draft'], resources: ['supplierMaster'], fields: ['taxId'], purposes: ['supplier-maintenance'],
        });
      },
    });
    expect(hazards(r)).toEqual(['P03|unauthorized:draft:supplierMaster|CASE-NEW-VALID']);
    expect(r.findings[0]!.witness.violation.reasons.join()).toMatch(/denied by rule R-DENY-TAXID/);
  });
});

describe('P05 escalation needs a valid escalated approval', () => {
  it('an escalated approval from an approver sharing the preparer credential does not satisfy the limit', () => {
    const r = run({ suite: 'assurance-boundaries', cases: ['CASE-LIMIT-OVER-ESCALATED'], variants: ['V-APPROVER-ALIAS'] });
    expect(hazards(r, 'P05')).toEqual(['P05|limit-exceeded-without-escalation|CASE-LIMIT-OVER-ESCALATED']);
    expect(hazards(r, 'P02').length).toBeGreaterThan(0);
  });
});

describe('goal witness replay re-derives the failure', () => {
  const bad = run({ variants: ['V-HOLD-ALL'] });
  const goal = bad.goalFailures.find((g) => g.kind === 'legitimate_hold' && g.caseId === 'CASE-ROUTINE')!;
  const { bundle } = prepared({ variants: ['V-HOLD-ALL'] });
  const design = { automationIds: [], controlIds: [] };
  it('verifies the genuine goal witness with a regenerated message', () => {
    const res = replayWitness(bundle, design, goal.witness!);
    expect(res.status).toBe('verified');
    expect(res.violation?.message).toBe(goal.message);
  });
  it('rejects a forged goal witness built from a genuinely successful path', () => {
    // a hazard id that the regenerated final state does not exhibit is rejected
    const forged: Witness = structuredClone(goal.witness!);
    forged.hazardId = 'GOAL|wrong_terminal|CASE-ROUTINE|held:x';
    expect(replayWitness(bundle, design, forged).status).toBe('rejected');
    // the same genuine steps under the baseline (no hold-all variant) do not fail any goal, so the forged claim cannot verify
    const clean = prepared().bundle;
    expect(analyze(selectCases(clean, ['CASE-ROUTINE']), design, ['CASE-ROUTINE'], DEFAULT_LIMITS).goalFailures).toEqual([]);
    const edited: Witness = structuredClone(goal.witness!);
    edited.steps[0]!.actorId = 'P-SOMEONE-ELSE';
    expect(replayWitness(bundle, design, edited).status).toBe('rejected');
  });
});
