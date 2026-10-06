import { describe, expect, it } from 'vitest';
import { analyze, applyVariants, replayWitness, selectCases } from '../../src/engine';
import { compileDesign } from '../../src/engine/compile';
import { buildReportEnvelope, computeHashes, md, parseReportEnvelope, reportToMarkdown, semanticReportJson, MAX_REPORT_BYTES } from '../../src/engine/report';
import { applyTransition, enabledTransitions, initialState } from '../../src/engine/transitions';
import { DEFAULT_LIMITS } from '../../src/model/schemas';
import { prepared, freshBundle } from '../helpers';

const design = { automationIds: ['A2', 'A3'], controlIds: [] as string[] };

async function envelopeFor(variants: string[] = []) {
  const model = freshBundle();
  const { bundle, caseIds } = prepared({ suite: 'flagship', variants });
  const analysis = analyze(bundle, design, caseIds, DEFAULT_LIMITS);
  const inputs = { model, variantIds: variants, design, caseIds, limits: DEFAULT_LIMITS };
  const hashes = await computeHashes(inputs);
  return { env: buildReportEnvelope({ inputs, hashes, analysis: { ...analysis, durationMs: 123 } }), analysis };
}

describe('reproducible reports', () => {
  it('hashes are deterministic, sensitive to inputs, and invariant to record permutation', async () => {
    const model = freshBundle();
    const inputs = { model, variantIds: [], design, caseIds: ['CASE-ROUTINE'], limits: DEFAULT_LIMITS };
    const h1 = await computeHashes(inputs);
    expect(h1).toEqual(await computeHashes(inputs));
    expect(h1.modelHash).toMatch(/^[0-9a-f]{64}$/);
    const shuffled = freshBundle();
    shuffled.entities.reverse();
    shuffled.contracts.reverse();
    shuffled.cases.reverse();
    expect((await computeHashes({ ...inputs, model: shuffled })).modelHash).toBe(h1.modelHash);
    expect((await computeHashes({ ...inputs, design: { automationIds: ['A2'], controlIds: [] } })).designHash).not.toBe(h1.designHash);
    const edited = freshBundle();
    edited.policies[4]!.params.limitCents = 1;
    const h2 = await computeHashes({ ...inputs, model: edited });
    expect(h2.policyHash).not.toBe(h1.policyHash);
    expect(h2.modelHash).not.toBe(h1.modelHash);
  });

  it('semantic JSON excludes observed runtime durations', async () => {
    const { env } = await envelopeFor();
    const again = { ...env, observed: { analysisMs: 999999 } };
    expect(semanticReportJson(again)).toBe(semanticReportJson(env));
    expect(JSON.stringify(env)).not.toContain('"durationMs"');
  });

  it('exported JSON restores the embedded model/design, reruns to the same result, and replays the saved witness', async () => {
    const { env, analysis } = await envelopeFor();
    const parsed = parseReportEnvelope(JSON.stringify(env));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.inputs.design).toEqual(design);
    expect(parsed.witnesses.length).toBe(analysis.findings.length + analysis.goalFailures.length);
    const restored = parsed.envelope.inputs;
    const variantBundle = applyVariants(restored.model, restored.variantIds);
    if (!variantBundle.ok) throw new Error('variants');
    const bundle = selectCases(variantBundle.bundle, restored.caseIds);
    const rerun = analyze(bundle, restored.design, restored.caseIds, restored.limits);
    expect(rerun.findings.map((f) => f.id)).toEqual(analysis.findings.map((f) => f.id));
    expect(rerun.findings.map((f) => f.witness)).toEqual(analysis.findings.map((f) => f.witness));
    const w = parsed.witnesses.find((x) => x.policyId === 'P01')!;
    expect(replayWitness(bundle, restored.design, w).status).toBe('verified');
  });

  it('rejects malformed, unsupported and oversized reports', async () => {
    const { env } = await envelopeFor();
    expect(parseReportEnvelope('not json').ok).toBe(false);
    expect(parseReportEnvelope(JSON.stringify({ ...env, format: 'other' })).ok).toBe(false);
    expect(parseReportEnvelope(JSON.stringify({ ...env, reportVersion: '9' })).ok).toBe(false);
    const broken = JSON.parse(JSON.stringify(env));
    broken.inputs.model.contracts[0].actorId = 'P-NOBODY';
    const r = parseReportEnvelope(JSON.stringify(broken));
    expect(r.ok).toBe(false);
    expect(parseReportEnvelope(' '.repeat(MAX_REPORT_BYTES + 1)).ok).toBe(false);
    const badCase = JSON.parse(JSON.stringify(env));
    badCase.inputs.caseIds = ['CASE-NOPE'];
    expect(parseReportEnvelope(JSON.stringify(badCase)).ok).toBe(false);
  });

  it('markdown carries hashes, versions, date, statuses, exact witness steps, evidence failure and the scope statement; strings are escaped', async () => {
    const { env } = await envelopeFor();
    const text = reportToMarkdown(env);
    expect(text).toContain(env.hashes.modelHash);
    expect(text).toContain('2026-10-06');
    expect(text).toMatch(/policyStatus: \*\*violated\*\*/);
    expect(text).toContain('P01|unverified-destination|CASE-NEW-VALID'.replace(/[|]/g, '\\|'));
    expect(text).toMatch(/evidence failure: no beneficiary verification evidence exists/);
    expect(text).toMatch(/not a compliance certification/i);
    const hostile = { ...env, scopeStatement: '<script>alert(1)</script> | **bold** [x](y)' };
    const t2 = reportToMarkdown(hostile);
    expect(t2).not.toContain('<script>');
    expect(md('a|b`c')).toBe('a\\|b\\`c');
  });
});

describe('gateway enforcement at the retry entry (W14)', () => {
  const caseId = 'CASE-RETRY-UNCERTAIN';
  function toUncertain(controls: string[]) {
    const { bundle } = prepared({ suite: 'uncertain-retry' });
    const c = compileDesign(bundle, { automationIds: [], controlIds: controls });
    if (!c.ok) throw new Error('compile');
    const rec = bundle.cases.find((x) => x.id === caseId)!;
    let s = initialState(c.model, rec);
    for (const id of ['W06:extract_correct', 'W07:match', 'W08:prepare', 'W09:retain', 'W10:approve_routine', 'W11:ack_uncertain']) {
      const t = enabledTransitions(c.model, rec, s).find((x) => x.id === id);
      if (!t) throw new Error(`not enabled: ${id}`);
      s = applyTransition(c.model, rec, s, t).state;
    }
    return { model: c.model, rec, s };
  }
  it('C2 gates W14 on valid evidence exactly like W11; without C2 the retry is not gated', () => {
    const withC2 = toUncertain(['C2']);
    withC2.s.evidence = withC2.s.evidence.filter((e) => e.kind !== 'beneficiaryVerification');
    expect(enabledTransitions(withC2.model, withC2.rec, withC2.s).map((t) => t.id)).toEqual(['W14:blocked:C2']);
    const plain = toUncertain([]);
    plain.s.evidence = plain.s.evidence.filter((e) => e.kind !== 'beneficiaryVerification');
    expect(enabledTransitions(plain.model, plain.rec, plain.s).map((t) => t.id)).toEqual(['W14:ack_ok']);
  });
});

describe('report import hardening', () => {
  it('rejects a witness with malformed events or tuples instead of crashing later', async () => {
    const { env } = await envelopeFor();
    for (const mutate of [
      (w: { steps: { events: unknown[] }[] }) => { w.steps[0]!.events = [{ kind: 'action' }]; },
      (w: { steps: { consumed: unknown[] }[] }) => { w.steps[0]!.consumed = [null]; },
    ]) {
      const copy = JSON.parse(JSON.stringify(env));
      mutate(copy.analysis.findings[0].witness);
      expect(parseReportEnvelope(JSON.stringify(copy)).ok).toBe(false);
    }
  });
  it('restores the comparison baseline and objective and rejects an oversized embedded model', async () => {
    const { env } = await envelopeFor();
    const withExtras = { ...env, inputs: { ...env.inputs, baselineDesign: { automationIds: ['A2'], controlIds: [] }, objective: 'maximum_value' } };
    const parsed = parseReportEnvelope(JSON.stringify(withExtras));
    expect(parsed.ok && parsed.envelope.inputs.baselineDesign).toEqual({ automationIds: ['A2'], controlIds: [] });
    expect(parsed.ok && parsed.envelope.inputs.objective).toBe('maximum_value');
    const huge = JSON.parse(JSON.stringify(env));
    huge.inputs.model.assumptions[0].text = 'x'.repeat(1024 * 1024);
    expect(parseReportEnvelope(JSON.stringify(huge)).ok).toBe(false);
  });
  it('policyHash is invariant to policy record order', async () => {
    const model = freshBundle();
    const inputs = { model, variantIds: [], design, caseIds: ['CASE-ROUTINE'], limits: DEFAULT_LIMITS };
    const h = await computeHashes(inputs);
    const shuffled = freshBundle();
    shuffled.policies.reverse();
    expect((await computeHashes({ ...inputs, model: shuffled })).policyHash).toBe(h.policyHash);
  });
});
