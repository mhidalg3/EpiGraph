import type { PolicyId } from './types';

export const ENTITY_KIND_DESCRIPTIONS: Record<string, { meaning: string; identifying: string }> = {
  OrgUnit: { meaning: 'Ownership/accountability grouping', identifying: 'ID and name; no implicit access grants' },
  Principal: {
    meaning: 'Human, service, or external actor',
    identifying: 'ID, principal kind, effective security identity, independence group, evidence status',
  },
  Role: { meaning: 'Scoped organizational or technical function', identifying: 'ID and named responsibilities; grants remain explicit' },
  System: {
    meaning: 'Processing or execution environment',
    identifying: 'Administrative boundary, approved purposes, accepted field categories',
  },
  Activity: { meaning: 'Guarded business operation', identifying: 'Workflow ID, inputs, outputs, actor binding, operation contract' },
  Asset: { meaning: 'Versioned business information', identifying: 'Asset kind, object ID, version, fields, lineage, category, source' },
  Evidence: {
    meaning: 'Immutable attestation about an exact object or action',
    identifying: 'Kind, issuer, subject tuple, method, sources, validity, provenance',
  },
  Control: {
    meaning: 'Implemented restriction or verification step',
    identifying: 'Target, enforcement mode, guard/effect, issuer requirements, cost',
  },
};

export const RELATION_KINDS: { id: string; direction: string; mustNotInfer: string }[] = [
  { id: 'ACCOUNTABLE_FOR', direction: 'OrgUnit → Activity', mustNotInfer: 'Ownership is not execution permission' },
  { id: 'HAS_ROLE / EXECUTES', direction: 'Principal → Role / Activity', mustNotInfer: 'A role name does not imply an unrestricted capability' },
  { id: 'CAN_CALL', direction: 'Principal → System (operation, resource)', mustNotInfer: 'A technical capability is not a company-policy authorization' },
  { id: 'CONSUMES / PRODUCES', direction: 'Asset → Activity / Activity → Asset', mustNotInfer: 'Information cannot flow through an activity without its contract' },
  { id: 'TRANSFERS_TO', direction: 'Activity → System (fields, purpose)', mustNotInfer: 'A timing dependency is not a data transfer' },
  { id: 'PRECEDES', direction: 'Activity → Activity (condition)', mustNotInfer: 'Precedence does not carry data or authority' },
  { id: 'DERIVED_FROM', direction: 'Derived Asset → Source Asset', mustNotInfer: 'Derivation does not increase integrity or remove restrictions' },
  { id: 'ATTESTS_TO', direction: 'Evidence → exact Asset version / payment tuple', mustNotInfer: 'Approval of one version does not approve another' },
  { id: 'GUARDS', direction: 'Control → Activity', mustNotInfer: 'A documented control is not necessarily implemented or unavoidable' },
];

export const POLICY_CATALOG: Record<PolicyId, { title: string; requirement: string; checkedAt: string }> = {
  P01: {
    title: 'Beneficiary integrity',
    requirement: 'The executed payment destination has valid independent verification for the exact supplier, bank version, and account digest.',
    checkedAt: 'Actual W11/W14 payload and pre-execution state',
  },
  P02: {
    title: 'Bound, independent approval',
    requirement: 'A valid approval covers the exact payment fingerprint and is independent of its preparer.',
    checkedAt: 'W11/W14 execution; also approval issuance',
  },
  P03: {
    title: 'Authorized operation',
    requirement: 'The executing principal, operation, resource and purpose satisfy the company authorization table.',
    checkedAt: 'Every modeled sensitive read, write, evidence issue, and payment action',
  },
  P04: {
    title: 'Restricted-data transfer',
    requirement: 'Restricted fields leave a boundary only to an approved recipient, for an approved purpose, within the permitted field set.',
    checkedAt: 'Every data-transfer event',
  },
  P05: {
    title: 'Business prerequisites',
    requirement: 'The supplier has onboarding clearance, the invoice version is matched, and the amount is within the authorization limit or has explicit escalation approval.',
    checkedAt: 'W11/W14 execution',
  },
  P06: {
    title: 'At-most-once settlement',
    requirement: 'A payment obligation is not settled more than once across the permitted retry.',
    checkedAt: 'W11 and W14',
  },
};

export const FINITE_SCOPE_STATEMENT =
  'A complete result means no violation was found across the declared finite model, cases, contracts, assumptions and policies, assuming the engine and compiler are correct. It is not a proof about a real company, a language model, or an arbitrary agent, and not a compliance certification. Reachability is a possibility statement, not a probability.';
