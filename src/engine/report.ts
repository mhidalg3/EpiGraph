import { z } from 'zod';
import { designSchema, evidenceKindSchema, limitsSchema, scalarSchema } from '../model/schemas';
import { FINITE_SCOPE_STATEMENT, POLICY_CATALOG } from '../model/ontology';
import {
  ENGINE_VERSION,
  HASH_ALGORITHM,
  type AnalysisLimits,
  type AnalysisReport,
  type CompositionReport,
  type Design,
  type DiffReport,
  type Finding,
  type ModelBundle,
  type PolicyId,
  type SynthesisReport,
  type Witness,
  type WitnessReplayResult,
} from '../model/types';
import { MAX_IMPORT_BYTES, parseBundle } from '../model/validate';
import type { ReportHashes } from '../workers/protocol';
import { canonicalJson } from './canonicalize';

export const REPORT_FORMAT = 'workflow-assurance-lab-report';
export const REPORT_VERSION = '1.0.0';
export const MAX_REPORT_BYTES = 16 * 1024 * 1024;

export interface ReportInputs {
  /** The model exactly as loaded (before named variants are applied). */
  model: ModelBundle;
  variantIds: string[];
  design: Design;
  caseIds: string[];
  limits: AnalysisLimits;
  baselineDesign?: Design;
  objective?: 'least_disruption' | 'maximum_value';
}

export interface ReportEnvelope {
  format: typeof REPORT_FORMAT;
  reportVersion: string;
  engineVersion: string;
  hashAlgorithm: string;
  hashes: ReportHashes;
  inputs: ReportInputs;
  scopeStatement: string;
  analysis?: AnalysisReport;
  diff?: DiffReport;
  composition?: CompositionReport;
  synthesis?: SynthesisReport;
  replay?: { witnessId: string; result: WitnessReplayResult };
  /** Observed runtime metadata; excluded from deterministic semantic comparison. */
  observed: { analysisMs?: number; compositionMs?: number; synthesisMs?: number };
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const byId = <T extends { id: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Unordered record collections are canonicalized by semantic id so record permutations hash identically. */
export function canonicalModel(b: ModelBundle): ModelBundle {
  const contract = <T extends { branches: { id: string }[]; implementedControlIds: string[] }>(c: T): T => ({ ...c, branches: byId(c.branches), implementedControlIds: [...c.implementedControlIds].sort() });
  const patchRec = <T extends { id: string; patch: { op: string }[] }>(p: T): T => ({ ...p, patch: p.patch.map((o) => ((o as { contract?: ModelBundle['contracts'][number] }).contract ? { ...o, contract: contract((o as unknown as { contract: ModelBundle['contracts'][number] }).contract) } : o)) });
  return {
    ...b,
    entities: byId(b.entities),
    contracts: byId(b.contracts).map(contract),
    capabilities: byId(b.capabilities),
    authorization: byId(b.authorization),
    policies: byId(b.policies),
    automations: byId(b.automations).map(patchRec),
    repairs: byId(b.repairs).map(patchRec),
    variants: byId(b.variants).map(patchRec),
    suites: byId(b.suites),
    cases: byId(b.cases),
    assumptions: byId(b.assumptions),
    appliedVariantIds: [...b.appliedVariantIds].sort(),
  } as ModelBundle;
}

/** Hashes are reproducibility identifiers of the canonical inputs, not trusted attestations. */
export async function computeHashes(inputs: ReportInputs): Promise<ReportHashes> {
  const { model, design, variantIds, caseIds, limits } = inputs;
  const [modelHash, designHash, policyHash] = await Promise.all([
    sha256Hex(canonicalJson(canonicalModel(model))),
    sha256Hex(canonicalJson({ design: { a: [...design.automationIds].sort(), c: [...design.controlIds].sort() }, variantIds: [...variantIds].sort(), caseIds: [...caseIds].sort(), limits, analysisDate: model.analysisDate })),
    sha256Hex(canonicalJson({ policies: byId(model.policies), policyVersion: model.policyVersion, analysisDate: model.analysisDate })),
  ]);
  return { algorithm: HASH_ALGORITHM, modelHash, designHash, policyHash };
}

export function buildReportEnvelope(args: {
  inputs: ReportInputs;
  hashes: ReportHashes;
  analysis?: AnalysisReport;
  diff?: DiffReport;
  composition?: CompositionReport;
  synthesis?: SynthesisReport;
  replay?: { witnessId: string; result: WitnessReplayResult };
}): ReportEnvelope {
  const strip = <T extends { durationMs?: number }>(r: T | undefined): T | undefined => {
    if (!r) return r;
    const { durationMs: _d, ...rest } = r;
    return rest as T;
  };
  return {
    format: REPORT_FORMAT,
    reportVersion: REPORT_VERSION,
    engineVersion: ENGINE_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    hashes: args.hashes,
    inputs: args.inputs,
    scopeStatement: FINITE_SCOPE_STATEMENT,
    ...(args.analysis ? { analysis: strip(args.analysis) } : {}),
    ...(args.diff ? { diff: args.diff } : {}),
    ...(args.composition ? { composition: args.composition } : {}),
    ...(args.synthesis ? { synthesis: strip(args.synthesis) } : {}),
    ...(args.replay ? { replay: args.replay } : {}),
    observed: {
      ...(args.analysis?.durationMs !== undefined ? { analysisMs: args.analysis.durationMs } : {}),
      ...(args.synthesis?.durationMs !== undefined ? { synthesisMs: args.synthesis.durationMs } : {}),
    },
  };
}

/** Canonical JSON of the semantic content only (observed runtime metadata removed). */
export function semanticReportJson(env: ReportEnvelope): string {
  const { observed: _o, ...rest } = env;
  return canonicalJson(rest);
}

const idStr = z.string().min(1).max(200);
const strs = z.array(z.string().max(400)).max(100);
const tupleRefSchema = z.object({ kind: idStr, objectId: z.string().max(200), version: z.number(), detail: z.string().max(2000).optional() }).strict();
const evidenceRecordSchema = z
  .object({
    id: idStr,
    kind: evidenceKindSchema,
    issuer: idStr,
    subject: z.record(z.string(), scalarSchema),
    method: z.string().max(200),
    sources: strs,
    validFrom: z.string().max(20),
    validUntil: z.string().max(20),
    escalation: z.boolean(),
    caseScope: idStr,
    provenance: z.enum(['initial', 'issued']),
    issuedBy: z.string().max(200),
  })
  .strict();
const paymentPayloadSchema = z
  .object({
    paymentId: z.string(),
    paymentVersion: z.number(),
    invoiceId: z.string(),
    invoiceVersion: z.number(),
    supplierId: z.string(),
    bankVersion: z.number(),
    accountDigest: z.string(),
    amountCents: z.number(),
    currency: z.string(),
    obligationId: z.string(),
    preparerId: z.string(),
  })
  .strict();
const eventBase = { activityId: idStr, actorId: idStr };
const modelEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('action'), ...eventBase, operation: idStr, resource: idStr, fields: strs, purpose: idStr }).strict(),
  z
    .object({
      kind: z.literal('transfer'),
      ...eventBase,
      to: idStr,
      boundary: z.enum(['internal', 'external']),
      purpose: idStr,
      fields: z.array(z.object({ name: idStr, source: z.string().max(200), categories: strs, lineage: strs, purposes: strs }).strict()).max(100),
      droppedByControl: strs,
    })
    .strict(),
  z.object({ kind: z.literal('evidenceIssued'), ...eventBase, evidence: evidenceRecordSchema, preparerId: z.string().nullable(), editorId: z.string().nullable() }).strict(),
  z.object({ kind: z.literal('paymentExecuted'), ...eventBase, payload: paymentPayloadSchema, obligationId: idStr, idempotencyKey: idStr, settlementsAfter: z.number(), retry: z.boolean() }).strict(),
  z.object({ kind: z.literal('receiptReplayed'), ...eventBase, obligationId: idStr, idempotencyKey: idStr }).strict(),
  z.object({ kind: z.literal('controlDecision'), activityId: idStr, controlId: idStr, decision: z.enum(['allow', 'block', 'replay', 'project']), reason: z.string().max(2000) }).strict(),
  z.object({ kind: z.literal('disposition'), activityId: idStr, disposition: z.enum(['reconciled', 'held']), reason: z.string().max(2000) }).strict(),
]);
const policyOrGoal = z.enum(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'GOAL']);
const witnessSchema = z
  .object({
    id: idStr,
    hazardId: idStr,
    policyId: policyOrGoal,
    caseId: idStr,
    bundleFingerprint: idStr,
    initialStateKeyHash: idStr,
    steps: z
      .array(
        z
          .object({
            index: z.number().int(),
            transitionId: idStr,
            activityId: idStr,
            branchId: idStr,
            actorId: idStr,
            summary: z.string().max(2000),
            consumed: z.array(tupleRefSchema).max(50),
            produced: z.array(tupleRefSchema).max(50),
            events: z.array(modelEventSchema).max(200),
            stateKeyHashAfter: idStr,
          })
          .strict(),
      )
      .max(500),
    violation: z.object({ policyId: policyOrGoal, stepIndex: z.number().int(), eventIndex: z.number().int(), message: z.string().max(4000), reasons: z.array(z.string().max(4000)).max(100) }).strict(),
  })
  .strict();

export type ParsedReport =
  | { ok: true; envelope: ReportEnvelope; witnesses: Witness[] }
  | { ok: false; error: string };

/**
 * Validates the envelope and restores embedded model/design for rerun/replay. Imported verdicts are never trusted:
 * callers must re-run analysis to obtain a fresh result.
 */
export function parseReportEnvelope(text: string): ParsedReport {
  if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES) return { ok: false, error: `Report exceeds ${MAX_REPORT_BYTES} bytes` };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Report must be a JSON object' };
  const o = raw as Record<string, unknown>;
  if (o.format !== REPORT_FORMAT) return { ok: false, error: `Unsupported report format: ${String(o.format)}` };
  if (o.reportVersion !== REPORT_VERSION) return { ok: false, error: `Unsupported report version: ${String(o.reportVersion)}` };
  const inputs = o.inputs as Record<string, unknown> | undefined;
  if (!inputs || typeof inputs !== 'object') return { ok: false, error: 'Report has no embedded inputs' };
  if (JSON.stringify(inputs.model ?? null).length > MAX_IMPORT_BYTES) return { ok: false, error: `Embedded model exceeds ${MAX_IMPORT_BYTES} bytes` };
  const model = parseBundle(inputs.model);
  if (!model.ok) return { ok: false, error: `Embedded model is invalid: ${model.reasons.slice(0, 5).join('; ')}` };
  const design = designSchema.safeParse(inputs.design);
  if (!design.success) return { ok: false, error: 'Embedded design is invalid' };
  const limits = limitsSchema.safeParse(inputs.limits);
  if (!limits.success) return { ok: false, error: 'Embedded limits are invalid' };
  const variantIds = Array.isArray(inputs.variantIds) && inputs.variantIds.every((x) => typeof x === 'string') ? (inputs.variantIds as string[]) : null;
  const caseIds = Array.isArray(inputs.caseIds) && inputs.caseIds.every((x) => typeof x === 'string') ? (inputs.caseIds as string[]) : null;
  if (!variantIds || !caseIds) return { ok: false, error: 'Embedded variant/case selection is invalid' };
  for (const v of variantIds) if (!model.bundle.variants.some((x) => x.id === v)) return { ok: false, error: `Unknown variant ${v}` };
  for (const c of caseIds) if (!model.bundle.cases.some((x) => x.id === c)) return { ok: false, error: `Unknown case ${c}` };

  const witnesses: Witness[] = [];
  const analysis = o.analysis as { findings?: { witness?: unknown }[]; goalFailures?: { witness?: unknown }[] } | undefined;
  for (const f of [...(analysis?.findings ?? []), ...(analysis?.goalFailures ?? [])]) {
    if (f.witness === null || f.witness === undefined) continue;
    const w = witnessSchema.safeParse(f.witness);
    if (!w.success) return { ok: false, error: `Embedded witness is invalid: ${w.error.issues[0]?.path.join('.') ?? ''} ${w.error.issues[0]?.message ?? ''}` };
    witnesses.push(w.data as Witness);
  }
  const baseline = inputs.baselineDesign === undefined ? undefined : designSchema.safeParse(inputs.baselineDesign);
  if (baseline && !baseline.success) return { ok: false, error: 'Embedded baseline design is invalid' };
  const envelope: ReportEnvelope = {
    ...(o as unknown as ReportEnvelope),
    inputs: {
      model: model.bundle,
      variantIds,
      design: design.data,
      caseIds,
      limits: limits.data,
      ...(baseline?.success ? { baselineDesign: baseline.data } : {}),
      ...(inputs.objective === 'least_disruption' || inputs.objective === 'maximum_value' ? { objective: inputs.objective } : {}),
    },
  };
  return { ok: true, envelope, witnesses };
}

// ---------- markdown ----------
/** Escape characters that carry Markdown meaning; imported strings are rendered as text. */
export function md(s: unknown): string {
  return String(s ?? '')
    .replace(/[\\`*_{}[\]<>()#+!|~]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, ' ');
}

const usd = (n: number) => `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function witnessMd(f: Finding): string[] {
  const w = f.witness;
  const out: string[] = [`#### ${md(f.id)}`, '', md(f.message), ''];
  if (f.enablingPatches.length) out.push(`Enabling patches: ${f.enablingPatches.map(md).join(', ')}`, '');
  for (const r of f.retainedSafeguards) out.push(`- ${md(r)}`);
  if (f.retainedSafeguards.length) out.push('');
  out.push('| # | Transition | Actor | Consumed | Produced |', '|---|---|---|---|---|');
  for (const s of w.steps)
    out.push(`| ${s.index + 1} | ${md(s.transitionId)} | ${md(s.actorId)} | ${md(s.consumed.map((t) => `${t.kind}@v${t.version}`).join(', '))} | ${md(s.produced.map((t) => `${t.kind}@v${t.version}`).join(', '))} |`);
  out.push('', `Violation (${md(w.violation.policyId)}): ${md(w.violation.message)}`);
  for (const r of w.violation.reasons) out.push(`- evidence failure: ${md(r)}`);
  out.push('');
  return out;
}

export function reportToMarkdown(env: ReportEnvelope): string {
  const L: string[] = [];
  const { inputs, hashes } = env;
  L.push('# Workflow Assurance Lab report', '', '> Fictional finite-model demonstration. Not a compliance certification.', '', md(env.scopeStatement), '');
  L.push('## Inputs and reproducibility', '');
  L.push(`- Engine version: ${md(env.engineVersion)}; schema ${md(inputs.model.schemaVersion)}; graph ${md(inputs.model.graphVersion)}; policy ${md(inputs.model.policyVersion)}`);
  L.push(`- Fixed analysis date: ${md(inputs.model.analysisDate)}`);
  L.push(`- Design: automations [${inputs.design.automationIds.map(md).join(', ')}], controls [${inputs.design.controlIds.map(md).join(', ')}], variants [${inputs.variantIds.map(md).join(', ')}]`);
  L.push(`- Cases: ${inputs.caseIds.map(md).join(', ')}`);
  L.push(`- Limits: ${inputs.limits.maxStatesPerCase} states/case, ${inputs.limits.maxTransitionsPerCase} transitions/case, ${inputs.limits.maxDesigns} designs`);
  L.push(`- Hash algorithm: ${md(hashes.algorithm)}`, `- modelHash: \`${hashes.modelHash}\``, `- designHash: \`${hashes.designHash}\``, `- policyHash: \`${hashes.policyHash}\``);
  L.push('- Hashes are reproducibility identifiers of canonical inputs, not attestations of correctness.', '');

  const a = env.analysis;
  if (a) {
    L.push('## Analysis', '');
    L.push(`- analysisStatus: **${a.analysisStatus}**; policyStatus: **${a.policyStatus}**; goalStatus: **${a.goalStatus}**`);
    L.push(`- Explored: ${a.totals.states} states, ${a.totals.transitions} transitions`);
    if (a.effective.requestedAutomationIds.join() !== a.effective.effectiveAutomationIds.join())
      L.push(`- Requested automations [${a.effective.requestedAutomationIds.join(', ')}]; effective after repairs [${a.effective.effectiveAutomationIds.join(', ')}]`);
    for (const r of [...a.invalidReasons, ...a.incompleteReasons]) L.push(`- ${md(r)}`);
    L.push('', '### Policies', '', '| Policy | Status | Detail |', '|---|---|---|');
    for (const p of a.policies) L.push(`| ${md(p.policyId)} ${md(POLICY_CATALOG[p.policyId as PolicyId]?.title ?? p.name)} | ${md(p.status)} | ${md(p.reason)} |`);
    L.push('', '### Cases', '', '| Case | Status | States | Terminal dispositions |', '|---|---|---|---|');
    for (const c of a.cases) L.push(`| ${md(c.caseId)} | ${md(c.status)} | ${c.statesExplored} | ${md(JSON.stringify(c.terminalDispositions))} |`);
    if (a.findings.length) {
      L.push('', '### Findings and witnesses', '');
      for (const f of a.findings) L.push(...witnessMd(f));
    }
    if (a.goalFailures.length) {
      L.push('### Business-goal failures', '');
      for (const g of a.goalFailures) L.push(`- ${md(g.caseId)}: ${md(g.message)}`);
      L.push('');
    }
    if (a.capabilityNotices.length) {
      L.push('### Technical capability excess (not witnessed executions)', '');
      for (const n of a.capabilityNotices) L.push(`- ${md(n.message)}`);
      L.push('');
    }
    L.push('### Applied patches', '');
    for (const p of a.effective.provenance) L.push(`- ${md(p.source)} (${p.stage}): ${md(p.summary)}`);
    L.push('');
  }

  if (env.diff) {
    const d = env.diff;
    L.push('## Design difference', '', `- Findings introduced: ${d.findings.introduced.length}; persistent: ${d.findings.persistent.length}; resolved: ${d.findings.resolved.length}`);
    L.push(`- Semantic atoms introduced: ${d.atoms.introduced.length}; removed: ${d.atoms.removed.length}; retained: ${d.atoms.retained.length}`);
    for (const x of d.atoms.introduced) L.push(`  - introduced: ${md(x.signature)}`);
    for (const n of d.notes) L.push(`- ${md(n)}`);
    L.push('');
  }

  if (env.composition) {
    L.push('## Composition (all automation subsets)', '', '| Automations | Analysis | Policy | Goals | Hazards |', '|---|---|---|---|---|');
    for (const s of env.composition.subsets) L.push(`| ${s.automationIds.length ? s.automationIds.map(md).join(' + ') : 'none'} | ${s.analysisStatus} | ${s.policyStatus} | ${s.goalStatus} | ${md(s.hazardIds.join('; ') || '—')} |`);
    L.push('');
    for (const h of env.composition.hazards) L.push(`- ${md(h.hazardId)}: ${h.status}; minimal sets ${h.minimalSets.map((m) => `{${m.join(',')}}`).join(' ') || '—'}. ${md(h.note)}`);
    L.push('');
  }

  if (env.synthesis) {
    const s = env.synthesis;
    L.push('## Repair search', '', `- Objective: ${s.objective}; optimizationStatus: **${s.optimizationStatus}**; analysisStatus: ${s.analysisStatus}`);
    const c = s.coverage;
    L.push(`- Coverage: ${c.rawCombinations} raw, ${c.applicable} applicable, ${c.noop} no-op, ${c.inapplicable} inapplicable, ${c.conflicting} conflicting, ${c.deduplicated} deduplicated, ${c.rechecked} rechecked, ${c.accepted} accepted, ${c.rejected} rejected, ${c.unknown} unknown${c.truncatedByMaxDesigns ? ' (truncated by maxDesigns)' : ''}`);
    for (const r of s.incompleteReasons) L.push(`- ${md(r)}`);
    L.push('', '| Automations | Controls | Verdict | Policy | Goals | Review h | Disruption USD/mo | Net USD/mo |', '|---|---|---|---|---|---|---|---|');
    for (const k of s.candidates.filter((x) => x.verdict !== 'rejected' || x.economics))
      L.push(`| ${md(k.automationIds.join('+') || 'none')} | ${md(k.controlIds.join('+') || '—')} | ${k.verdict} | ${k.policyStatus} | ${k.goalStatus} | ${k.economics ? k.economics.addedReviewHours.toFixed(2) : '—'} | ${k.economics ? usd(k.economics.disruptionUsd) : '—'} | ${k.economics ? usd(k.economics.netValueUsd) : '—'} |`);
    if (s.best) L.push('', `Best verified candidate: automations [${s.best.automationIds.join(', ')}], controls [${s.best.controlIds.join(', ')}]`);
    L.push('', '### Economic assumptions used', '');
    for (const t of s.assumptionsUsed) L.push(`- ${md(t)}`);
    L.push('');
  }

  if (env.replay) L.push('## Witness replay', '', `- ${md(env.replay.witnessId)}: **${env.replay.result.status}** (${env.replay.result.verifiedSteps} steps verified)`, ...env.replay.result.reasons.map((r) => `- ${md(r)}`), '');

  L.push('## Assurance statement and assumptions', '', md(env.scopeStatement), '');
  for (const t of env.analysis?.assumptions ?? []) L.push(`- ${md(t)}`);
  for (const t of inputs.model.assumptions) L.push(`- (${md(t.evidenceStatus)}) ${md(t.text)}`);
  return L.join('\n') + '\n';
}
