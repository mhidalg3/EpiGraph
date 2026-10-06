import { projectRelations } from './project';
import { bundleSchema, type EffectExpr, type ModelBundle, type PatchOp, type PredicateExpr } from './schemas';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_ENTITIES = 100;
export const MAX_PROJECTED_RELATIONS = 150;

export type ParseResult = { ok: true; bundle: ModelBundle } | { ok: false; reasons: string[] };

const CREDENTIAL_KEY = /(password|passwd|secret|token|api[_-]?key|credential|private[_-]?key|bearer|authorization[_-]?header)/i;

function scanCredentialKeys(v: unknown, path: string, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x, i) => scanCredentialKeys(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (CREDENTIAL_KEY.test(k)) out.push(`Credential-shaped field '${path}.${k}' is not accepted in fixtures`);
      scanCredentialKeys(x, `${path}.${k}`, out);
    }
}

/** Size check, JSON parse, credential scan, strict shape validation, then semantic validation. */
export function parseBundle(input: string | unknown): ParseResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > MAX_IMPORT_BYTES) return { ok: false, reasons: [`Import exceeds ${MAX_IMPORT_BYTES} bytes`] };
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, reasons: [`Not valid JSON: ${(e as Error).message}`] };
    }
  }
  const cred: string[] = [];
  scanCredentialKeys(raw, '$', cred);
  if (cred.length > 0) return { ok: false, reasons: cred };
  const r = bundleSchema.safeParse(raw);
  if (!r.success) return { ok: false, reasons: r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '$'}: ${i.message}`) };
  const issues = semanticIssues(r.data);
  return issues.length > 0 ? { ok: false, reasons: issues } : { ok: true, bundle: r.data };
}

function dup(ids: string[], label: string, out: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) out.push(`Duplicate ${label} id ${id}`);
    seen.add(id);
  }
}

function walkPredicate(p: PredicateExpr, f: (p: PredicateExpr) => void): void {
  f(p);
  if (p.op === 'all' || p.op === 'any') p.args.forEach((a) => walkPredicate(a, f));
  else if (p.op === 'not') walkPredicate(p.arg, f);
}

function contractsOf(b: ModelBundle) {
  const out = [...b.contracts];
  for (const rec of [...b.automations, ...b.repairs, ...b.variants])
    for (const op of rec.patch) if (op.op === 'setContract' || op.op === 'ensureContract') out.push(op.contract);
  return out;
}

const EVIDENCE_FIELDS: Record<string, string[]> = {
  beneficiaryVerification: ['accountDigest', 'bankVersion', 'supplierId'],
  onboardingClearance: ['supplierId'],
  paymentAuthorization: ['accountDigest', 'amountCents', 'bankVersion', 'currency', 'invoiceId', 'invoiceVersion', 'paymentId', 'paymentVersion', 'supplierId'],
};

/** Semantic validation: references, scopes, supported operations, evidence shape, bounds and patch targets. */
export function semanticIssues(b: ModelBundle): string[] {
  const out: string[] = [];
  dup(b.entities.map((e) => e.id), 'entity', out);
  dup(b.contracts.map((c) => c.id), 'contract', out);
  dup(b.capabilities.map((g) => g.id), 'capability', out);
  dup(b.authorization.map((r) => r.id), 'authorization rule', out);
  dup(b.policies.map((p) => p.id), 'policy', out);
  dup(b.cases.map((c) => c.id), 'case', out);
  dup(b.suites.map((s) => s.id), 'suite', out);
  dup([...b.automations, ...b.repairs, ...b.variants].map((x) => x.id), 'patch record', out);
  dup(b.assumptions.map((a) => a.id), 'assumption', out);

  const ids = (kind: string) => new Set(b.entities.filter((e) => e.kind === kind).map((e) => e.id));
  const principals = ids('Principal');
  const systems = ids('System');
  const roles = ids('Role');
  const orgs = ids('OrgUnit');
  const activities = ids('Activity');
  const controls = ids('Control');
  const caseIds = new Set(b.cases.map((c) => c.id));
  const suiteIds = new Set(b.suites.map((s) => s.id));

  if (b.entities.length > MAX_ENTITIES) out.push(`More than ${MAX_ENTITIES} entities`);
  const relations = projectRelations(b).length;
  if (relations > MAX_PROJECTED_RELATIONS) out.push(`${relations} projected relations exceed the limit of ${MAX_PROJECTED_RELATIONS}`);
  for (const p of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06']) if (!b.policies.some((x) => x.id === p)) out.push(`Missing policy ${p}`);

  for (const e of b.entities) {
    if (e.kind === 'Principal') {
      for (const r of e.roleIds) if (!roles.has(r)) out.push(`Principal ${e.id} references unknown role ${r}`);
      if (e.orgUnitId && !orgs.has(e.orgUnitId)) out.push(`Principal ${e.id} references unknown org unit ${e.orgUnitId}`);
    }
    if (e.kind === 'Activity' && !orgs.has(e.ownerOrgUnitId)) out.push(`Activity ${e.id} references unknown org unit ${e.ownerOrgUnitId}`);
  }

  const checkContract = (c: ModelBundle['contracts'][number], where: string) => {
    if (!activities.has(c.id)) out.push(`${where}: contract ${c.id} has no Activity entity`);
    if (!principals.has(c.actorId)) out.push(`${where}: contract ${c.id} actor ${c.actorId} is not a Principal`);
    for (const r of c.capabilityRequirements) if (!systems.has(r.system)) out.push(`${where}: contract ${c.id} requires unknown system ${r.system}`);
    for (const k of c.implementedControlIds) if (!controls.has(k)) out.push(`${where}: contract ${c.id} references unknown control ${k}`);
    dup(c.branches.map((x) => x.id), `branch of ${c.id}`, out);
    const effects: EffectExpr[] = [...c.effects, ...c.branches.flatMap((x) => x.effects)];
    for (const e of effects) {
      if (e.op === 'issueEvidence' && c.operation !== 'verify' && c.operation !== 'authorize')
        out.push(`${where}: contract ${c.id} (${c.operation}) may not issue attestations; only verify/authorize operations can`);
      if (e.op === 'recordTransfer' && !systems.has(e.to)) out.push(`${where}: contract ${c.id} transfers to unknown system ${e.to}`);
      if (e.op === 'createAsset' && e.kind === 'supplierMaster' && c.operation !== 'propose' && c.operation !== 'commitVersion')
        out.push(`${where}: contract ${c.id} creates supplierMaster with unsupported operation ${c.operation}`);
    }
    if (c.operation === 'execute' && c.branches.length === 0) out.push(`${where}: execute contract ${c.id} has no branches`);
  };
  b.contracts.forEach((c) => checkContract(c, 'baseline'));
  for (const rec of [...b.automations, ...b.repairs, ...b.variants])
    for (const op of rec.patch) if (op.op === 'setContract' || op.op === 'ensureContract') checkContract(op.contract, `patch ${rec.id}`);

  for (const e of b.entities)
    if (e.kind === 'Control' && e.guard) {
      const bad: string[] = [];
      walkPredicate(e.guard, (p) => {
        if (p.op === 'evidence' && p.target === 'supplier' && p.name !== 'hasClearance') bad.push(p.name);
      });
      if (bad.length) out.push(`Control ${e.id} has an unsupported evidence target`);
    }

  for (const g of b.capabilities) {
    if (!principals.has(g.principalId)) out.push(`Grant ${g.id} references unknown principal ${g.principalId}`);
    if (!systems.has(g.system)) out.push(`Grant ${g.id} references unknown system ${g.system}`);
  }
  for (const r of b.authorization) {
    for (const p of r.principalIds) if (!principals.has(p)) out.push(`Rule ${r.id} references unknown principal ${p}`);
    for (const x of r.roleIds) if (!roles.has(x)) out.push(`Rule ${r.id} references unknown role ${x}`);
  }

  const allContractIds = new Set(contractsOf(b).map((c) => c.id));
  const allGrantIds = new Set(b.capabilities.map((g) => g.id));
  const allRuleIds = new Set(b.authorization.map((r) => r.id));
  for (const rec of [...b.automations, ...b.repairs, ...b.variants])
    for (const op of rec.patch) {
      if (op.op === 'addCapability') allGrantIds.add(op.grant.id);
      if (op.op === 'addAuthRule') allRuleIds.add(op.rule.id);
    }
  for (const rec of [...b.automations, ...b.repairs, ...b.variants]) {
    for (const op of rec.patch as PatchOp[]) {
      switch (op.op) {
        case 'removeContract':
        case 'setPrecondition':
        case 'setBranches':
          if (!allContractIds.has(op.id)) out.push(`Patch ${rec.id}: unknown contract ${op.id}`);
          break;
        case 'setActor':
          if (!allContractIds.has(op.id)) out.push(`Patch ${rec.id}: unknown contract ${op.id}`);
          if (!principals.has(op.actorId)) out.push(`Patch ${rec.id}: unknown principal ${op.actorId}`);
          break;
        case 'addControl':
        case 'removeControl':
          if (!allContractIds.has(op.id)) out.push(`Patch ${rec.id}: unknown contract ${op.id}`);
          if (!controls.has(op.controlId)) out.push(`Patch ${rec.id}: unknown control ${op.controlId}`);
          break;
        case 'addCapability':
          if (!principals.has(op.grant.principalId)) out.push(`Patch ${rec.id}: unknown principal ${op.grant.principalId}`);
          if (!systems.has(op.grant.system)) out.push(`Patch ${rec.id}: unknown system ${op.grant.system}`);
          break;
        case 'removeCapability':
          // only for variants already applied to this bundle is the removed grant legitimately gone; automation/repair patches keep being checked
          if (!b.appliedVariantIds.includes(rec.id) && !allGrantIds.has(op.grantId)) out.push(`Patch ${rec.id}: unknown grant ${op.grantId}`);
          break;
        case 'removeAuthRule':
          if (!b.appliedVariantIds.includes(rec.id) && !allRuleIds.has(op.ruleId)) out.push(`Patch ${rec.id}: unknown rule ${op.ruleId}`);
          break;
        case 'setSystem':
          if (!systems.has(op.id)) out.push(`Patch ${rec.id}: unknown system ${op.id}`);
          break;
        case 'setPrincipal':
          if (!principals.has(op.id)) out.push(`Patch ${rec.id}: unknown principal ${op.id}`);
          break;
        case 'setControlImplementation':
          if (!controls.has(op.id)) out.push(`Patch ${rec.id}: unknown control ${op.id}`);
          break;
        case 'setLabel':
          if (!b.entities.some((e) => e.id === op.id)) out.push(`Patch ${rec.id}: unknown entity ${op.id}`);
          break;
        default:
          break;
      }
    }
  }

  for (const s of b.suites) for (const c of s.caseIds) if (!caseIds.has(c)) out.push(`Suite ${s.id} references unknown case ${c}`);
  for (const c of b.cases) {
    for (const s of c.suiteIds) if (!suiteIds.has(s)) out.push(`Case ${c.id} references unknown suite ${s}`);
    for (const a of c.requiresAutomations) if (!b.automations.some((x) => x.id === a)) out.push(`Case ${c.id} requires unknown automation ${a}`);
    for (const k of Object.keys(c.branchDomains)) if (!allContractIds.has(k)) out.push(`Case ${c.id} restricts unknown activity ${k}`);
    for (const a of c.initialAssets)
      for (const f of a.fields) if (f.name === 'currency' && f.value !== 'USD') out.push(`Case ${c.id}: unsupported currency ${String(f.value)} (USD only)`);
    if (c.env.currency !== undefined && c.env.currency !== 'USD') out.push(`Case ${c.id}: unsupported currency ${String(c.env.currency)} (USD only)`);
    for (const e of c.initialEvidence) {
      if (!principals.has(e.issuer)) out.push(`Case ${c.id}: initial evidence ${e.id} has unknown issuer ${e.issuer}`);
      const want = EVIDENCE_FIELDS[e.kind]!;
      const have = Object.keys(e.subject).sort();
      if (want.join(',') !== have.join(',')) out.push(`Case ${c.id}: initial evidence ${e.id} has malformed subject (${have.join(',')}), expected (${want.join(',')})`);
      if (e.validFrom > e.validUntil) out.push(`Case ${c.id}: initial evidence ${e.id} has validFrom after validUntil`);
    }
  }
  for (const k of b.economics.classes) if (!caseIds.has(k.caseId)) out.push(`Economics class ${k.id} references unknown case ${k.caseId}`);
  for (const k of Object.keys(b.economics.controlCosts)) if (!b.repairs.some((r) => r.id === k)) out.push(`Economics has a cost for unknown control ${k}`);
  return out;
}
