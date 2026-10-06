import type {
  AnalysisLimits,
  Design,
  RequiredOutcome,
  Scalar,
} from './schemas';

export type {
  ActivityContract,
  ActivityEntity,
  AnalysisLimits,
  AssetSel,
  AuthorizationRule,
  Branch,
  CapabilityGrant,
  CapabilityRequirement,
  CaseRecord,
  ControlEntity,
  Design,
  EconomicAssumptions,
  EffectExpr,
  Entity,
  ModelBundle,
  OnBlock,
  PatchOp,
  PolicyRecord,
  PredicateExpr,
  PrincipalEntity,
  Ref,
  RepairRecord,
  RequiredOutcome,
  Scalar,
  SuiteRecord,
  SystemEntity,
} from './schemas';

export const ENGINE_VERSION = '0.1.0';
export const HASH_ALGORITHM = 'SHA-256 over canonical JSON (UTF-8)';

// ---------- status vocabulary ----------
export type AnalysisStatus = 'complete' | 'partial' | 'invalid';
export type PolicyStatus = 'satisfied_in_model' | 'violated' | 'unknown';
export type GoalStatus = 'satisfied' | 'failed' | 'unknown';
export type OptimizationStatus = 'optimal_in_catalog' | 'best_verified_found' | 'no_feasible_design' | 'unknown';
export type PolicyId = 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06';
export const POLICY_IDS: readonly PolicyId[] = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06'];

// ---------- execution model ----------
export interface FieldValue {
  value: Scalar;
  lineage: string[];
  categories: string[];
  purposes: string[];
}

export interface AssetInstance {
  kind: string;
  objectId: string;
  version: number;
  status: string;
  fields: Record<string, FieldValue>;
}

export interface EvidenceRecord {
  id: string;
  kind: 'beneficiaryVerification' | 'onboardingClearance' | 'paymentAuthorization';
  issuer: string;
  subject: Record<string, Scalar>;
  method: string;
  sources: string[];
  validFrom: string;
  validUntil: string;
  escalation: boolean;
  caseScope: string;
  provenance: 'initial' | 'issued';
  issuedBy: string;
}

export interface ExecutionState {
  facts: Record<string, Scalar>;
  assets: Record<string, AssetInstance>;
  evidence: EvidenceRecord[];
}

export interface PaymentPayload {
  paymentId: string;
  paymentVersion: number;
  invoiceId: string;
  invoiceVersion: number;
  supplierId: string;
  bankVersion: number;
  accountDigest: string;
  amountCents: number;
  currency: string;
  obligationId: string;
  preparerId: string;
}

export interface TransferFieldRecord {
  name: string;
  source: string;
  categories: string[];
  lineage: string[];
  purposes: string[];
}

export type ModelEvent =
  | {
      kind: 'action';
      activityId: string;
      actorId: string;
      operation: string;
      resource: string;
      fields: string[];
      purpose: string;
    }
  | {
      kind: 'transfer';
      activityId: string;
      actorId: string;
      to: string;
      boundary: 'internal' | 'external';
      purpose: string;
      fields: TransferFieldRecord[];
      droppedByControl: string[];
    }
  | {
      kind: 'evidenceIssued';
      activityId: string;
      actorId: string;
      evidence: EvidenceRecord;
      preparerId: string | null;
      editorId: string | null;
    }
  | {
      kind: 'paymentExecuted';
      activityId: string;
      actorId: string;
      payload: PaymentPayload;
      obligationId: string;
      idempotencyKey: string;
      settlementsAfter: number;
      retry: boolean;
    }
  | {
      kind: 'receiptReplayed';
      activityId: string;
      actorId: string;
      obligationId: string;
      idempotencyKey: string;
    }
  | {
      kind: 'controlDecision';
      activityId: string;
      controlId: string;
      decision: 'allow' | 'block' | 'replay' | 'project';
      reason: string;
    }
  | { kind: 'disposition'; activityId: string; disposition: 'reconciled' | 'held'; reason: string };

// ---------- witnesses ----------
export interface TupleRef {
  kind: string;
  objectId: string;
  version: number;
  detail?: string;
}

export interface WitnessStep {
  index: number;
  transitionId: string;
  activityId: string;
  branchId: string;
  actorId: string;
  summary: string;
  consumed: TupleRef[];
  produced: TupleRef[];
  events: ModelEvent[];
  stateKeyHashAfter: string;
}

export interface Witness {
  id: string;
  hazardId: string;
  policyId: PolicyId | 'GOAL';
  caseId: string;
  bundleFingerprint: string;
  initialStateKeyHash: string;
  steps: WitnessStep[];
  violation: {
    policyId: PolicyId | 'GOAL';
    stepIndex: number;
    eventIndex: number;
    message: string;
    reasons: string[];
  };
}

export interface WitnessReplayResult {
  status: 'verified' | 'rejected';
  reasons: string[];
  verifiedSteps: number;
  failingStepIndex: number | null;
  violation: Witness['violation'] | null;
}

// ---------- findings ----------
export interface PatchProvenance {
  source: string; // 'variant:no-c3' | 'A2' | 'C1'
  stage: 'variant' | 'automation' | 'control';
  summary: string;
  changed: boolean;
}

export interface Finding {
  id: string; // hazard id
  policyId: PolicyId;
  caseId: string;
  mechanism: string;
  message: string;
  witness: Witness;
  enablingPatches: string[];
  retainedSafeguards: string[];
}

export interface GoalFailure {
  id: string;
  caseId: string;
  kind: 'wrong_terminal' | 'deadlock' | 'second_settlement' | 'legitimate_hold';
  message: string;
  required: RequiredOutcome;
  actual: string;
  witness: Witness | null;
}

export interface SemanticAtom {
  signature: string;
  source: string;
  destination: string;
  purpose: string;
  authority: 'claim' | 'recommendation' | 'execute';
  evidence: string;
  policyScope: string;
}

export interface CapabilityNotice {
  principalId: string;
  grantId: string;
  system: string;
  operation: string;
  resource: string;
  message: string;
}

export interface PolicyResult {
  policyId: PolicyId;
  name: string;
  status: PolicyStatus;
  findingIds: string[];
  reason: string;
}

export interface CaseReport {
  caseId: string;
  label: string;
  status: 'complete' | 'partial' | 'invalid' | 'skipped';
  statesExplored: number;
  transitionsExplored: number;
  terminalDispositions: Record<string, number>;
  deadlocks: number;
  reasons: string[];
}

export interface EffectiveDesign {
  requestedAutomationIds: string[];
  effectiveAutomationIds: string[];
  requestedControlIds: string[];
  appliedControlIds: string[];
  noopControlIds: string[];
  inapplicableControlIds: string[];
  variantIds: string[];
  provenance: PatchProvenance[];
}

export interface AnalysisReport {
  engineVersion: string;
  schemaVersion: string;
  graphVersion: string;
  policyVersion: string;
  analysisDate: string;
  analysisStatus: AnalysisStatus;
  policyStatus: PolicyStatus;
  goalStatus: GoalStatus;
  design: Design;
  effective: EffectiveDesign;
  caseIds: string[];
  cases: CaseReport[];
  policies: PolicyResult[];
  findings: Finding[];
  goalFailures: GoalFailure[];
  atoms: SemanticAtom[];
  capabilityNotices: CapabilityNotice[];
  assumptions: string[];
  incompleteReasons: string[];
  invalidReasons: string[];
  limits: AnalysisLimits;
  totals: { states: number; transitions: number };
  semanticKey: string;
  durationMs?: number;
}

export interface DiffReport {
  baseline: AnalysisReport;
  candidate: AnalysisReport;
  atoms: { introduced: SemanticAtom[]; removed: SemanticAtom[]; retained: SemanticAtom[] };
  findings: {
    introduced: Finding[];
    persistent: Finding[];
    resolved: Finding[];
  };
  notes: string[];
  completeForRemoval: boolean;
}

export interface CompositionSubset {
  automationIds: string[];
  analysisStatus: AnalysisStatus;
  policyStatus: PolicyStatus;
  goalStatus: GoalStatus;
  hazardIds: string[];
  report: AnalysisReport;
}

export interface HazardMinimality {
  hazardId: string;
  policyId: PolicyId;
  caseId: string;
  mechanism: string;
  status: 'established' | 'unknown' | 'not_minimal_only';
  minimalSets: string[][];
  reachableIn: string[][];
  unknownSubsets: string[][];
  note: string;
}

export interface CompositionReport {
  engineVersion: string;
  caseIds: string[];
  subsets: CompositionSubset[];
  hazards: HazardMinimality[];
  analysisStatus: AnalysisStatus;
  incompleteReasons: string[];
}

// ---------- economics ----------
export interface ClassEconomics {
  classId: string;
  label: string;
  monthlyCount: number;
  minutesPerEvent: number;
  verificationMinutesPerEvent: number;
  route: string[];
  routeStatus: 'ok' | 'unavailable';
}

export interface DesignEconomics {
  classes: ClassEconomics[];
  grossBenefitUsd: number;
  recurringPlatformUsd: number;
  recurringControlUsd: number;
  setupMonthlyUsd: number;
  netValueUsd: number;
  addedReviewHours: number;
  lostBenefitUsd: number;
  addedRecurringUsd: number;
  addedSetupMonthlyUsd: number;
  disruptionUsd: number;
  changedElements: number;
  assumptionsUsed: string[];
}

export type CandidateVerdict = 'accepted' | 'rejected' | 'unknown';

export interface SynthesisCandidate {
  key: string;
  controlIds: string[];
  automationIds: string[];
  effectiveAutomationIds: string[];
  appliedControlIds: string[];
  noopControlIds: string[];
  applicability: 'applicable' | 'noop' | 'inapplicable' | 'conflicting';
  verdict: CandidateVerdict;
  rejectionReasons: string[];
  policyStatus: PolicyStatus;
  goalStatus: GoalStatus;
  analysisStatus: AnalysisStatus;
  capacityOk: boolean;
  economics: DesignEconomics | null;
  hazardIds: string[];
  deduplicatedFrom: string[];
}

export interface SearchCoverage {
  rawCombinations: number;
  applicable: number;
  noop: number;
  inapplicable: number;
  conflicting: number;
  deduplicated: number;
  rechecked: number;
  rejected: number;
  accepted: number;
  unknown: number;
  truncatedByMaxDesigns: boolean;
}

export interface SynthesisReport {
  engineVersion: string;
  objective: 'least_disruption' | 'maximum_value';
  requested: Design;
  optimizationStatus: OptimizationStatus;
  analysisStatus: AnalysisStatus;
  candidates: SynthesisCandidate[];
  unrepaired: SynthesisCandidate | null;
  best: SynthesisCandidate | null;
  coverage: SearchCoverage;
  incompleteReasons: string[];
  assumptionsUsed: string[];
  semanticKey: string;
  durationMs?: number;
}
