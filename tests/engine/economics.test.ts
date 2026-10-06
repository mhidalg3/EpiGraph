import { describe, expect, it } from 'vitest';
import { clearSynthesisCache, synthesize } from '../../src/engine';
import { DEFAULT_LIMITS } from '../../src/model/schemas';
import type { ModelBundle, SynthesisReport } from '../../src/model/types';
import { prepared } from '../helpers';

const REQUESTED = { automationIds: ['A1', 'A2', 'A3'], controlIds: [] as string[] };

function synth(o: { cap?: number; paid?: number; objective?: 'least_disruption' | 'maximum_value'; limits?: typeof DEFAULT_LIMITS; variants?: string[]; mutate?: (b: ModelBundle) => void }): SynthesisReport {
  clearSynthesisCache();
  const { bundle } = prepared({ suite: 'flagship', variants: o.variants });
  if (o.cap !== undefined) bundle.economics.reviewCapacityHours = o.cap;
  if (o.paid !== undefined) bundle.economics.monthly.paidSupplierEvents = o.paid;
  o.mutate?.(bundle);
  return synthesize(bundle, REQUESTED, o.objective ?? 'least_disruption', o.limits ?? DEFAULT_LIMITS);
}
const cand = (r: SynthesisReport, key: string) => r.candidates.find((c) => c.key === `A1+A2+A3|${key}`)!;

describe('worked economics (all three automations, 16-hour budget)', () => {
  const r = synth({});
  it('reproduces the stipulated arithmetic', () => {
    expect(cand(r, 'none').economics!.netValueUsd).toBe(8800);
    expect(cand(r, 'C1').economics!.netValueUsd).toBe(8160);
    expect(cand(r, 'C1').economics!.addedReviewHours).toBe(10);
    expect(cand(r, 'C2').economics!.netValueUsd).toBe(8360);
    expect(cand(r, 'C2').economics!.addedReviewHours).toBe(6);
    expect(cand(r, 'C5').economics!.netValueUsd).toBe(8000);
    expect(cand(r, 'C5').economics!.addedReviewHours).toBeCloseTo(13.33, 2);
    expect(cand(r, 'none').economics!.grossBenefitUsd).toBe(9800);
  });
  it('keeps the unsafe design visible but unrankable and selects C2 with a complete search', () => {
    expect(cand(r, 'none').verdict).toBe('rejected');
    expect(cand(r, 'none').rejectionReasons.join()).toMatch(/P01 reachable/);
    expect(r.unrepaired?.key).toBe('A1+A2+A3|none');
    expect(r.best?.key).toBe('A1+A2+A3|C2');
    expect(r.optimizationStatus).toBe('optimal_in_catalog');
    expect(r.analysisStatus).toBe('complete');
    expect(r.coverage.rawCombinations).toBe(64);
    expect(r.coverage.deduplicated).toBe(56);
  });
  it('charges verification once when C1 and C2 overlap', () => {
    const both = cand(r, 'C1+C2').economics!;
    expect(both.addedReviewHours).toBe(10);
    expect(both.netValueUsd).toBe(8080);
  });
  it('shows C5 as requested-but-not-effective and retains platform cost', () => {
    expect(cand(r, 'C5').effectiveAutomationIds).toEqual(['A1', 'A3']);
    expect(cand(r, 'C5').economics!.recurringPlatformUsd).toBe(700);
  });
  it('already-present C3/C6 and inapplicable C4 add neither repair count nor cost', () => {
    expect(r.candidates.every((c) => !c.appliedControlIds.some((id) => ['C3', 'C4', 'C6'].includes(id)))).toBe(true);
    expect(r.candidates.every((c) => c.economics === null || c.economics.addedRecurringUsd === c.appliedControlIds.length * 0 + (c.appliedControlIds.includes('C1') ? 40 : 0) + (c.appliedControlIds.includes('C2') ? 80 : 0))).toBe(true);
  });
});

describe('sensitivity', () => {
  it('eight-hour budget: C1 and C5 are rejected for capacity, C2 remains', () => {
    const r = synth({ cap: 8 });
    expect(cand(r, 'C1').rejectionReasons.join()).toMatch(/review capacity exceeded/);
    expect(cand(r, 'C5').rejectionReasons.join()).toMatch(/review capacity exceeded/);
    expect(cand(r, 'C2').verdict).toBe('accepted');
    expect(r.best?.key).toBe('A1+A2+A3|C2');
  });
  it('100 paid supplier events with a 16-hour budget prefers C1 over C2', () => {
    const r = synth({ paid: 100 });
    expect(cand(r, 'C1').economics!.netValueUsd).toBe(8160);
    expect(cand(r, 'C2').economics!.netValueUsd).toBe(8120);
    expect(r.best?.key).toBe('A1+A2+A3|C1');
  });
  it('four review hours: no fixed all-three repair is feasible, complete rejection of the catalog', () => {
    const r = synth({ cap: 4 });
    expect(r.best).toBeNull();
    expect(r.optimizationStatus).toBe('no_feasible_design');
  });
  it('economic edits change values but never policy or goal verdicts', () => {
    const a = synth({});
    const b = synth({ mutate: (x) => { x.economics.humanHourValueUsd = 90; } });
    expect(b.candidates.map((c) => [c.key, c.verdict, c.policyStatus, c.goalStatus])).toEqual(a.candidates.map((c) => [c.key, c.verdict, c.policyStatus, c.goalStatus]));
    expect(cand(b, 'C2').economics!.netValueUsd).not.toBe(cand(a, 'C2').economics!.netValueUsd);
  });
});

describe('joint selection', () => {
  const r = synth({ objective: 'maximum_value' });
  it('rechecks all unique combinations of the 512 raw catalog and maximizes monthly net value', () => {
    expect(r.coverage.rawCombinations).toBe(512);
    expect(r.optimizationStatus).toBe('optimal_in_catalog');
    const accepted = r.candidates.filter((c) => c.verdict === 'accepted');
    expect(accepted.length).toBe(r.coverage.accepted);
    expect(accepted.every((c) => c.policyStatus === 'satisfied_in_model' && c.goalStatus === 'satisfied' && c.capacityOk)).toBe(true);
    const bestNet = Math.max(...accepted.map((c) => c.economics!.netValueUsd));
    expect(r.best!.economics!.netValueUsd).toBe(bestNet);
    expect(r.best!.key).toBe('A1+A2+A3|C2');
  });
  it('four review hours: joint selection retains fewer automations with baseline safeguards (A1+A3, USD 8,000)', () => {
    const s = synth({ objective: 'maximum_value', cap: 4 });
    expect(s.best?.key).toBe('A1+A3|none');
    expect(s.best!.economics!.netValueUsd).toBe(8000);
    expect(s.best!.economics!.addedReviewHours).toBe(0);
    expect(s.optimizationStatus).toBe('optimal_in_catalog');
    // while no repair of the requested all-three design fits in four hours
    const fixed = synth({ cap: 4 });
    expect(fixed.best).toBeNull();
    expect(fixed.optimizationStatus).toBe('no_feasible_design');
  });
  it('never recommends holding everything or disabling payment', () => {
    const holdAll = synth({ variants: ['V-HOLD-ALL'] });
    expect(holdAll.best).toBeNull();
    expect(holdAll.optimizationStatus).toBe('no_feasible_design');
    // no human submitter capability and no payment agent requested: no candidate can ever pay
    clearSynthesisCache();
    const { bundle } = prepared({ suite: 'flagship', variants: ['V-NO-PAYMENT-CAPABILITY'] });
    const none = synthesize(bundle, { automationIds: ['A1', 'A2'], controlIds: [] }, 'least_disruption', DEFAULT_LIMITS);
    expect(none.best).toBeNull();
    expect(none.optimizationStatus).toBe('no_feasible_design');
  });
});

describe('search coverage never over-claims', () => {
  it('truncating by maxDesigns never yields optimal_in_catalog and keeps the remainder visible', () => {
    const r = synth({ objective: 'maximum_value', limits: { ...DEFAULT_LIMITS, maxDesigns: 20 } });
    expect(r.optimizationStatus).not.toBe('optimal_in_catalog');
    expect(r.coverage.truncatedByMaxDesigns).toBe(true);
    expect(r.analysisStatus).toBe('partial');
    expect(r.incompleteReasons.join()).toMatch(/maxDesigns/);
  });
  it('a candidate exploration cap leaves candidates unknown, never accepted, and never no_feasible_design', () => {
    const r = synth({ limits: { ...DEFAULT_LIMITS, maxStatesPerCase: 5 } });
    expect(r.candidates.filter((c) => c.verdict === 'accepted')).toEqual([]);
    expect(r.coverage.unknown).toBeGreaterThan(0);
    expect(r.optimizationStatus).toBe('unknown');
  });
});

describe('review regressions', () => {
  it('capacity is measured against the unrepaired requested design even when a control is already applied', () => {
    clearSynthesisCache();
    const { bundle } = prepared({ suite: 'flagship' });
    bundle.economics.reviewCapacityHours = 4;
    const r = synthesize(bundle, { automationIds: ['A1', 'A2', 'A3'], controlIds: ['C2'] }, 'least_disruption', DEFAULT_LIMITS);
    const c2 = r.candidates.find((c) => c.key === 'A1+A2+A3|C2')!;
    expect(c2.economics!.addedReviewHours).toBe(6);
    expect(c2.verdict).toBe('rejected');
    expect(r.best).toBeNull();
  });

  it('the synthesis cache is keyed on full repair patch contents, not ids', () => {
    clearSynthesisCache();
    const first = prepared({ suite: 'flagship' }).bundle;
    const a = synthesize(first, REQUESTED, 'least_disruption', DEFAULT_LIMITS);
    expect(a.best?.key).toBe('A1+A2+A3|C2');
    const second = prepared({ suite: 'flagship' }).bundle;
    const c2 = second.repairs.find((x) => x.id === 'C2')!;
    c2.patch = c2.patch.filter((o) => !(o.op === 'addControl' && o.controlId === 'C2')); // C2 no longer gates the gateway
    const b = synthesize(second, REQUESTED, 'least_disruption', DEFAULT_LIMITS);
    expect(b.best?.key).not.toBe('A1+A2+A3|C2');
    expect(b.candidates.find((c) => c.key === 'A1+A2+A3|C2')!.verdict).toBe('rejected');
  });
});
