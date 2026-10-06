import type {
  AnalysisReport,
  CaseRecord,
  DiffReport,
  ExecutionState,
  Finding,
  ModelEvent,
  SemanticAtom,
} from '../model/types';
import type { CompiledModel } from './compile';
import { beneficiaryTuple, explainApproval, explainBeneficiary } from './evidence';

/**
 * Normalized semantic atoms: derived from single feasible events, keyed by business lineage/category,
 * destination, purpose, authority and verification state. Labels, actors and traversal order are excluded.
 */
export function atomsOf(model: CompiledModel, c: CaseRecord, pre: ExecutionState, events: ModelEvent[]): SemanticAtom[] {
  const out: SemanticAtom[] = [];
  const mk = (a: Omit<SemanticAtom, 'signature'>): SemanticAtom => ({
    ...a,
    signature: `${a.source} -> ${a.destination}; purpose=${a.purpose}; authority=${a.authority}; ${a.evidence}; scope=${a.policyScope}`,
  });
  for (const ev of events) {
    if (ev.kind === 'paymentExecuted') {
      const p = ev.payload;
      const master = pre.assets[`supplierMaster:${p.bankVersion}`];
      const acct = master?.fields.accountDigest;
      const editor = typeof master?.fields.editor?.value === 'string' ? (master.fields.editor.value as string) : null;
      const ben = explainBeneficiary(model, pre, c.id, beneficiaryTuple(p), editor);
      const apr = explainApproval(model, pre, c.id, p);
      out.push(
        mk({
          source: `${(acct?.lineage ?? []).join('+') || 'unknown-lineage'}:${(acct?.categories ?? []).join('+') || 'uncategorized'}`,
          destination: 'payment.execute',
          purpose: 'payment-execution',
          authority: 'execute',
          evidence: `beneficiaryEvidence=${ben.valid ? 'valid' : 'missing-or-invalid'}; approval=${apr.valid ? 'valid' : 'missing-or-invalid'}`,
          policyScope: 'P01,P02,P05,P06',
        }),
      );
    } else if (ev.kind === 'transfer') {
      const lineage = [...new Set(ev.fields.flatMap((f) => f.lineage))].sort().join('+') || 'unknown-lineage';
      const cats = [...new Set(ev.fields.flatMap((f) => f.categories))].sort().join('+') || 'unrestricted';
      out.push(
        mk({
          source: `${lineage}:${cats}`,
          destination: `${ev.to}(${ev.boundary})`,
          purpose: ev.purpose,
          authority: 'claim',
          evidence: 'n/a',
          policyScope: 'P04',
        }),
      );
    } else if (ev.kind === 'action' && ev.resource === 'supplierMaster' && ev.operation === 'commit') {
      const v = pre.facts['draft.version'];
      const m = typeof v === 'number' ? pre.assets[`supplierMaster:${v}`] : undefined;
      const acct = m?.fields.accountDigest;
      const ben = m
        ? explainBeneficiary(model, pre, c.id, beneficiaryTuple({ supplierId: m.objectId, bankVersion: m.version, accountDigest: String(acct?.value ?? '') }), typeof m.fields.editor?.value === 'string' ? (m.fields.editor.value as string) : null)
        : { valid: false };
      out.push(
        mk({
          source: `${(acct?.lineage ?? []).join('+') || 'unknown-lineage'}:${(acct?.categories ?? []).join('+') || 'uncategorized'}`,
          destination: 'supplierMaster.commit',
          purpose: ev.purpose,
          authority: 'execute',
          evidence: `beneficiaryEvidence=${ben.valid ? 'valid' : 'missing-or-invalid'}`,
          policyScope: 'P01,P03',
        }),
      );
    }
  }
  return out;
}

const bySig = (xs: SemanticAtom[]) => new Map(xs.map((a) => [a.signature, a]));

export function diffReports(baseline: AnalysisReport, candidate: AnalysisReport): DiffReport {
  const b = bySig(baseline.atoms);
  const cd = bySig(candidate.atoms);
  const introduced = [...cd.values()].filter((a) => !b.has(a.signature));
  const removed = [...b.values()].filter((a) => !cd.has(a.signature));
  const retained = [...cd.values()].filter((a) => b.has(a.signature));

  const bf = new Map(baseline.findings.map((f) => [f.id, f]));
  const cf = new Map(candidate.findings.map((f) => [f.id, f]));
  const fIntroduced: Finding[] = [];
  const fPersistent: Finding[] = [];
  const fResolved: Finding[] = [];
  for (const f of cf.values()) (bf.has(f.id) ? fPersistent : fIntroduced).push(f);
  for (const f of bf.values()) if (!cf.has(f.id)) fResolved.push(f);

  const notes: string[] = [];
  const completeForRemoval = baseline.analysisStatus === 'complete' && candidate.analysisStatus === 'complete';
  if (!completeForRemoval)
    notes.push('At least one analysis is incomplete: absent atoms/findings cannot establish removal or resolution; they are unknown.');
  if (baseline.analysisStatus !== 'complete')
    notes.push('The baseline is incomplete: findings and atoms labelled introduced were not reached in the baseline run, which does not establish that the baseline lacks them.');
  if (baseline.findings.length > 0 && fIntroduced.length === 0)
    notes.push('The baseline itself violates policy; absence of new findings does not make the candidate acceptable.');
  const bySigSort = (x: SemanticAtom, y: SemanticAtom) => (x.signature < y.signature ? -1 : 1);
  const byId = (x: Finding, y: Finding) => (x.id < y.id ? -1 : 1);
  return {
    baseline,
    candidate,
    atoms: {
      introduced: introduced.sort(bySigSort),
      removed: completeForRemoval ? removed.sort(bySigSort) : [],
      retained: retained.sort(bySigSort),
    },
    findings: {
      introduced: fIntroduced.sort(byId),
      persistent: fPersistent.sort(byId),
      resolved: completeForRemoval ? fResolved.sort(byId) : [],
    },
    notes,
    completeForRemoval,
  };
}
