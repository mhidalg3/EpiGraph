import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0' as const;

// ---------- primitives ----------
const idRe = /^[A-Za-z0-9_.:@\-]{1,64}$/;
export const idSchema = z.string().regex(idRe, 'invalid identifier');
const text = z.string().min(1).max(600);
/** Fact/env keys are selectors into plain objects: restricted charset, no prototype keys. */
export const factKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:@{}-]{1,80}$/, 'invalid fact key')
  .refine((k) => !['__proto__', 'constructor', 'prototype'].includes(k), 'reserved key');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const scalarSchema = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof scalarSchema>;

export const EVIDENCE_STATUSES = ['fixture', 'observed', 'assumed', 'unknown'] as const;
export const ASSET_KINDS = [
  'supplierClaim',
  'supplierMaster',
  'invoice',
  'orderReceiptMatch',
  'paymentRequest',
  'paymentReceipt',
] as const;
export const EVIDENCE_KINDS = ['beneficiaryVerification', 'onboardingClearance', 'paymentAuthorization'] as const;
export const OPERATIONS = [
  'copy',
  'extract',
  'projectFields',
  'combine',
  'propose',
  'commitVersion',
  'verify',
  'authorize',
  'execute',
  'hold',
] as const;
export const ENTITY_KINDS = ['OrgUnit', 'Principal', 'Role', 'System', 'Activity', 'Asset', 'Evidence', 'Control'] as const;

export const evidenceStatusSchema = z.enum(EVIDENCE_STATUSES);
export const assetKindSchema = z.enum(ASSET_KINDS);
export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);
export const operationSchema = z.enum(OPERATIONS);

const metaShape = {
  id: idSchema,
  schemaVersion: z.literal(SCHEMA_VERSION),
  sourceRef: text,
  evidenceStatus: evidenceStatusSchema,
};

// ---------- asset selectors, refs, predicates, effects ----------
export const assetSelSchema = z
  .object({
    kind: assetKindSchema,
    select: z.union([z.literal('latest'), z.object({ fact: factKeySchema }).strict()]),
  })
  .strict();
export type AssetSel = z.infer<typeof assetSelSchema>;

export const fieldRefSchema = z.object({ asset: assetSelSchema, name: z.string().min(1).max(60) }).strict();
export type FieldRef = z.infer<typeof fieldRefSchema>;

export const refSchema = z.discriminatedUnion('ref', [
  z.object({ ref: z.literal('lit'), value: scalarSchema }).strict(),
  z.object({ ref: z.literal('fact'), key: factKeySchema }).strict(),
  z.object({ ref: z.literal('env'), key: factKeySchema }).strict(),
  z.object({ ref: z.literal('actor') }).strict(),
  z.object({ ref: z.literal('field'), asset: assetSelSchema, name: z.string().min(1).max(60) }).strict(),
  z.object({ ref: z.literal('version'), asset: assetSelSchema }).strict(),
  z.object({ ref: z.literal('factPlus'), key: factKeySchema, add: z.number().int() }).strict(),
  z.object({ ref: z.literal('policy'), policyId: idSchema, key: z.string().min(1).max(60) }).strict(),
]);
export type Ref = z.infer<typeof refSchema>;

export const EVIDENCE_PREDICATES = ['validBeneficiary', 'validApproval', 'hasClearance', 'payloadBound'] as const;

export type PredicateExpr =
  | { op: 'all'; args: PredicateExpr[] }
  | { op: 'any'; args: PredicateExpr[] }
  | { op: 'not'; arg: PredicateExpr }
  | { op: 'equals'; left: Ref; right: Ref }
  | { op: 'compare'; left: Ref; cmp: 'lt' | 'lte' | 'gt' | 'gte'; right: Ref }
  | { op: 'evidence'; name: (typeof EVIDENCE_PREDICATES)[number]; target: 'draft' | 'payload' | 'supplier' }
  | { op: 'exists'; asset: AssetSel };

export const predicateSchema: z.ZodType<PredicateExpr> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('all'), args: z.array(predicateSchema).max(16) }).strict(),
    z.object({ op: z.literal('any'), args: z.array(predicateSchema).max(16) }).strict(),
    z.object({ op: z.literal('not'), arg: predicateSchema }).strict(),
    z.object({ op: z.literal('equals'), left: refSchema, right: refSchema }).strict(),
    z
      .object({ op: z.literal('compare'), left: refSchema, cmp: z.enum(['lt', 'lte', 'gt', 'gte']), right: refSchema })
      .strict(),
    z
      .object({
        op: z.literal('evidence'),
        name: z.enum(EVIDENCE_PREDICATES),
        target: z.enum(['draft', 'payload', 'supplier']),
      })
      .strict(),
    z.object({ op: z.literal('exists'), asset: assetSelSchema }).strict(),
  ]),
) as z.ZodType<PredicateExpr>;

export const assetFieldSpecSchema = z
  .object({
    name: z.string().min(1).max(60),
    value: refSchema,
    derivedFrom: z.array(fieldRefSchema).max(8).optional(),
    lineage: z.array(z.string().max(60)).max(8).optional(),
    categories: z.array(z.string().max(40)).max(8).optional(),
    purposes: z.array(z.string().max(40)).max(8).optional(),
  })
  .strict();
export type AssetFieldSpec = z.infer<typeof assetFieldSpecSchema>;

export const effectSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('setField'),
      target: z.union([
        z.object({ kind: z.literal('fact'), key: factKeySchema }).strict(),
        z.object({ kind: z.literal('asset'), asset: assetSelSchema, name: z.string().min(1).max(60) }).strict(),
      ]),
      value: refSchema,
      derivedFrom: z.array(fieldRefSchema).max(8).optional(),
    })
    .strict(),
  z
    .object({ op: z.literal('incrementCounter'), key: factKeySchema, by: z.number().int().default(1) })
    .strict(),
  z
    .object({
      op: z.literal('createAsset'),
      kind: assetKindSchema,
      objectId: refSchema,
      version: refSchema,
      status: z.string().max(40).optional(),
      fields: z.array(assetFieldSpecSchema).max(24),
    })
    .strict(),
  z
    .object({
      op: z.literal('issueEvidence'),
      kind: evidenceKindSchema,
      subject: z.enum(['draft', 'committed', 'supplier', 'payment']),
      method: refSchema,
      sources: z.array(refSchema).max(6),
      escalation: refSchema.optional(),
      validDays: z.number().int().min(1).max(3650).default(365),
    })
    .strict(),
  z
    .object({
      op: z.literal('recordTransfer'),
      to: idSchema,
      purpose: z.string().min(1).max(40),
      fields: z.array(fieldRefSchema).min(1).max(24),
    })
    .strict(),
  z
    .object({
      op: z.literal('recordAction'),
      operation: z.string().min(1).max(40),
      resource: z.string().min(1).max(60),
      fields: z.array(z.string().max(60)).max(12),
      purpose: z.string().min(1).max(40),
    })
    .strict(),
  z
    .object({
      op: z.literal('setDisposition'),
      disposition: z.enum(['reconciled', 'held']),
      reason: refSchema.optional(),
    })
    .strict(),
]);
export type EffectExpr = z.infer<typeof effectSchema>;

// ---------- contracts ----------
export const branchSchema = z
  .object({
    id: idSchema,
    when: predicateSchema.optional(),
    nominal: z.boolean().default(true),
    minutes: z.number().min(0).max(600).default(0),
    verification: z.boolean().default(false),
    effects: z.array(effectSchema).max(24),
  })
  .strict();
export type Branch = z.infer<typeof branchSchema>;

export const scopedInputSchema = z
  .object({ asset: assetSelSchema, role: z.string().min(1).max(40) })
  .strict();

export const capabilityRequirementSchema = z
  .object({ system: idSchema, operation: z.string().min(1).max(40), resource: z.string().min(1).max(60) })
  .strict();
export type CapabilityRequirement = z.infer<typeof capabilityRequirementSchema>;

export const contractSchema = z
  .object({
    ...metaShape,
    workflowId: idSchema,
    actorId: idSchema,
    operation: operationSchema,
    inputs: z.array(scopedInputSchema).max(8),
    capabilityRequirements: z.array(capabilityRequirementSchema).max(8),
    workflowPreconditions: predicateSchema,
    implementedControlIds: z.array(idSchema).max(8),
    effects: z.array(effectSchema).max(24),
    branches: z.array(branchSchema).min(1).max(8),
  })
  .strict();
export type ActivityContract = z.infer<typeof contractSchema>;

// ---------- entities ----------
const orgUnit = z.object({ ...metaShape, kind: z.literal('OrgUnit'), name: text }).strict();
const principal = z
  .object({
    ...metaShape,
    kind: z.literal('Principal'),
    name: text,
    principalKind: z.enum(['human', 'service', 'external']),
    effectiveIdentityId: idSchema,
    independenceGroup: idSchema,
    roleIds: z.array(idSchema).max(8),
    orgUnitId: idSchema.optional(),
  })
  .strict();
const role = z
  .object({ ...metaShape, kind: z.literal('Role'), name: text, responsibilities: z.array(text).max(8) })
  .strict();
const system = z
  .object({
    ...metaShape,
    kind: z.literal('System'),
    name: text,
    boundary: z.enum(['internal', 'external']),
    approvedPurposes: z.array(z.string().max(40)).max(10),
    acceptedCategories: z.array(z.string().max(40)).max(10),
    approvedFields: z.array(z.string().max(60)).max(30).optional(),
  })
  .strict();
const activity = z
  .object({
    ...metaShape,
    kind: z.literal('Activity'),
    name: text,
    workflowId: idSchema,
    lane: z.enum(['supplier', 'invoice']),
    ownerOrgUnitId: idSchema,
    conditional: z.boolean(),
    summary: text,
  })
  .strict();
const asset = z
  .object({
    ...metaShape,
    kind: z.literal('Asset'),
    name: text,
    assetKind: assetKindSchema,
    description: text,
  })
  .strict();
const evidenceEntity = z
  .object({
    ...metaShape,
    kind: z.literal('Evidence'),
    name: text,
    evidenceKind: evidenceKindSchema,
    subjectFields: z.array(z.string().max(40)).min(1).max(12),
    description: text,
  })
  .strict();
export const onBlockSchema = z
  .object({ when: predicateSchema.optional(), reason: z.string().min(1).max(80), effects: z.array(effectSchema).max(16) })
  .strict();
export type OnBlock = z.infer<typeof onBlockSchema>;
const control = z
  .object({
    ...metaShape,
    kind: z.literal('Control'),
    name: text,
    mode: z.enum(['guard', 'transform', 'idempotent']),
    implemented: z.union([z.boolean(), z.literal('unknown')]),
    description: text,
    guard: predicateSchema.optional(),
    onBlock: z.array(onBlockSchema).max(4).optional(),
    projectAwayUnacceptedCategories: z.boolean().optional(),
  })
  .strict();
export const entitySchema = z.discriminatedUnion('kind', [
  orgUnit,
  principal,
  role,
  system,
  activity,
  asset,
  evidenceEntity,
  control,
]);
export type Entity = z.infer<typeof entitySchema>;
export type PrincipalEntity = z.infer<typeof principal>;
export type SystemEntity = z.infer<typeof system>;
export type ActivityEntity = z.infer<typeof activity>;
export type ControlEntity = z.infer<typeof control>;
export type OrgUnitEntity = z.infer<typeof orgUnit>;
export type RoleEntity = z.infer<typeof role>;

// ---------- capability / authorization ----------
export const grantSchema = z
  .object({
    ...metaShape,
    principalId: idSchema,
    system: idSchema,
    operation: z.string().min(1).max(40),
    resource: z.string().min(1).max(60),
  })
  .strict();
export type CapabilityGrant = z.infer<typeof grantSchema>;

export const authRuleSchema = z
  .object({
    ...metaShape,
    effect: z.enum(['allow', 'deny']),
    principalIds: z.array(idSchema).max(12),
    roleIds: z.array(idSchema).max(12),
    operations: z.array(z.string().max(40)).min(1).max(12),
    resources: z.array(z.string().max(60)).min(1).max(12),
    fields: z.array(z.string().max(60)).max(24).optional(),
    purposes: z.array(z.string().max(40)).min(1).max(12),
  })
  .strict();
export type AuthorizationRule = z.infer<typeof authRuleSchema>;

// ---------- patches ----------
const keyed = z.string().min(1).max(80);
export const patchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setContract'), contract: contractSchema }).strict(),
  z.object({ op: z.literal('ensureContract'), contract: contractSchema }).strict(),
  z.object({ op: z.literal('removeContract'), id: idSchema }).strict(),
  z.object({ op: z.literal('setPrecondition'), id: idSchema, expr: predicateSchema }).strict(),
  z.object({ op: z.literal('setBranches'), id: idSchema, branches: z.array(branchSchema).min(1).max(8) }).strict(),
  z.object({ op: z.literal('setActor'), id: idSchema, actorId: idSchema }).strict(),
  z.object({ op: z.literal('addControl'), id: idSchema, controlId: idSchema }).strict(),
  z.object({ op: z.literal('removeControl'), id: idSchema, controlId: idSchema }).strict(),
  z.object({ op: z.literal('addCapability'), grant: grantSchema }).strict(),
  z.object({ op: z.literal('removeCapability'), grantId: idSchema }).strict(),
  z.object({ op: z.literal('addAuthRule'), rule: authRuleSchema }).strict(),
  z.object({ op: z.literal('removeAuthRule'), ruleId: idSchema }).strict(),
  z
    .object({
      op: z.literal('setSystem'),
      id: idSchema,
      boundary: z.enum(['internal', 'external']).optional(),
      acceptedCategories: z.array(z.string().max(40)).max(10).optional(),
      approvedPurposes: z.array(z.string().max(40)).max(10).optional(),
    })
    .strict(),
  z
    .object({ op: z.literal('setPrincipal'), id: idSchema, effectiveIdentityId: idSchema.optional(), independenceGroup: idSchema.optional() })
    .strict(),
  z.object({ op: z.literal('setControlImplementation'), id: idSchema, implemented: z.union([z.boolean(), z.literal('unknown')]) }).strict(),
  z.object({ op: z.literal('setCompleteness'), key: z.enum(['capabilityInventory', 'controlImplementation']), value: z.enum(['complete', 'unknown']) }).strict(),
  z.object({ op: z.literal('setLabel'), id: idSchema, name: keyed }).strict(),
]);
export type PatchOp = z.infer<typeof patchOpSchema>;

export const patchRecordSchema = z
  .object({
    ...metaShape,
    label: text,
    description: text,
    patch: z.array(patchOpSchema).max(40),
  })
  .strict();
export type PatchRecord = z.infer<typeof patchRecordSchema>;

export const automationSchema = patchRecordSchema;
export const repairSchema = patchRecordSchema
  .extend({
    applicability: z
      .object({
        requiresExternalTransferOtherThan: z.array(idSchema).max(6).optional(),
      })
      .strict(),
  })
  .strict();
export type RepairRecord = z.infer<typeof repairSchema>;
export const variantSchema = patchRecordSchema;

// ---------- policies ----------
export const policySchema = z
  .object({
    ...metaShape,
    name: text,
    requirement: text,
    params: z.record(z.string(), scalarSchema.or(z.array(z.string().max(80)).max(20))),
  })
  .strict();
export type PolicyRecord = z.infer<typeof policySchema>;

// ---------- cases ----------
export const initialAssetSchema = z
  .object({
    kind: assetKindSchema,
    objectId: z.string().min(1).max(60),
    version: z.number().int().min(0).max(9),
    status: z.string().max(40).optional(),
    fields: z
      .array(
        z
          .object({
            name: z.string().min(1).max(60),
            value: scalarSchema,
            lineage: z.array(z.string().max(60)).max(8).optional(),
            categories: z.array(z.string().max(40)).max(8).optional(),
            purposes: z.array(z.string().max(40)).max(8).optional(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type InitialAsset = z.infer<typeof initialAssetSchema>;

export const initialEvidenceSchema = z
  .object({
    id: idSchema,
    kind: evidenceKindSchema,
    issuer: idSchema,
    subject: z.record(z.string(), scalarSchema),
    method: z.string().min(1).max(60),
    sources: z.array(z.string().max(60)).max(6),
    validFrom: dateStr,
    validUntil: dateStr,
    escalation: z.boolean().optional(),
    caseScope: z.string().min(1).max(64),
    admission: z.object({ basis: text }).strict(),
  })
  .strict();
export type InitialEvidence = z.infer<typeof initialEvidenceSchema>;

export const requiredOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reconciled') }).strict(),
  z.object({ kind: z.literal('held'), reason: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal('supplier_committed') }).strict(),
]);
export type RequiredOutcome = z.infer<typeof requiredOutcomeSchema>;

export const caseSchema = z
  .object({
    ...metaShape,
    label: text,
    legitimate: z.boolean(),
    requiredOutcome: requiredOutcomeSchema,
    env: z.record(factKeySchema, scalarSchema),
    initialFacts: z.record(factKeySchema, scalarSchema),
    initialAssets: z.array(initialAssetSchema).max(8),
    initialEvidence: z.array(initialEvidenceSchema).max(8),
    branchDomains: z.record(z.string(), z.array(idSchema).max(8)),
    requiresAutomations: z.array(idSchema).max(3),
    suiteIds: z.array(idSchema).max(6),
    economicClass: z.enum(['routineInvoice', 'supplierEventPaid', 'supplierEventUnpaid']).optional(),
    economicOnly: z.boolean().default(false),
  })
  .strict();
export type CaseRecord = z.infer<typeof caseSchema>;

export const suiteSchema = z
  .object({ ...metaShape, label: text, description: text, caseIds: z.array(idSchema).min(1).max(20) })
  .strict();
export type SuiteRecord = z.infer<typeof suiteSchema>;

// ---------- economics & assumptions ----------
export const economicsSchema = z
  .object({
    ...metaShape,
    monthly: z
      .object({
        invoices: z.number().int().min(0).max(1_000_000),
        supplierEvents: z.number().int().min(0).max(1_000_000),
        paidSupplierEvents: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
    humanHourValueUsd: z.number().positive().max(10_000),
    reviewCapacityHours: z.number().min(0).max(100_000),
    amortizationMonths: z.number().int().min(1).max(120),
    platform: z.object({ recurringUsd: z.number().min(0), setupUsd: z.number().min(0) }).strict(),
    controlCosts: z.record(z.string(), z.object({ recurringUsd: z.number().min(0), setupUsd: z.number().min(0) }).strict()),
    classes: z
      .array(
        z
          .object({
            id: z.enum(['routineInvoice', 'supplierEventPaid', 'supplierEventUnpaid']),
            label: text,
            caseId: idSchema,
            routeActivities: z.array(idSchema).min(1).max(20),
          })
          .strict(),
      )
      .length(3),
  })
  .strict()
  .refine((e) => e.monthly.paidSupplierEvents <= Math.min(e.monthly.invoices, e.monthly.supplierEvents), {
    message: 'paidSupplierEvents must be within 0..min(invoices, supplierEvents)',
    path: ['monthly', 'paidSupplierEvents'],
  });
export type EconomicAssumptions = z.infer<typeof economicsSchema>;

export const assumptionSchema = z
  .object({ ...metaShape, text: z.string().min(1).max(800), category: z.enum(['scope', 'economic', 'modeling', 'assurance']) })
  .strict();
export type AssumptionRecord = z.infer<typeof assumptionSchema>;

// ---------- bundle ----------
export const completenessSchema = z
  .object({
    capabilityInventory: z.enum(['complete', 'unknown']),
    controlImplementation: z.enum(['complete', 'unknown']),
    evidenceInventory: z.enum(['complete', 'unknown']),
  })
  .strict();

export const bundleSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    graphVersion: z.string().min(1).max(20),
    policyVersion: z.string().min(1).max(20),
    analysisDate: dateStr,
    completeness: completenessSchema,
    entities: z.array(entitySchema).max(100),
    contracts: z.array(contractSchema).max(14),
    capabilities: z.array(grantSchema).max(80),
    authorization: z.array(authRuleSchema).max(80),
    policies: z.array(policySchema).length(6),
    automations: z.array(automationSchema).max(3),
    repairs: z.array(repairSchema).max(6),
    variants: z.array(variantSchema).max(30),
    suites: z.array(suiteSchema).max(10),
    cases: z.array(caseSchema).max(40),
    economics: economicsSchema,
    assumptions: z.array(assumptionSchema).max(60),
    appliedVariantIds: z.array(idSchema).max(10).default([]),
  })
  .strict();
export type ModelBundle = z.infer<typeof bundleSchema>;

// ---------- design & limits ----------
export const designSchema = z
  .object({ automationIds: z.array(idSchema).max(3), controlIds: z.array(idSchema).max(6) })
  .strict();
export type Design = z.infer<typeof designSchema>;

export const limitsSchema = z
  .object({
    maxStatesPerCase: z.number().int().min(1).max(10_000_000),
    maxTransitionsPerCase: z.number().int().min(1).max(100_000_000),
    maxDesigns: z.number().int().min(1).max(100_000),
  })
  .strict();
export type AnalysisLimits = z.infer<typeof limitsSchema>;
export const DEFAULT_LIMITS: AnalysisLimits = { maxStatesPerCase: 25_000, maxTransitionsPerCase: 250_000, maxDesigns: 512 };
