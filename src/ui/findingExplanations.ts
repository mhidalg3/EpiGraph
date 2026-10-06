import type { Finding, GoalFailure, RequiredOutcome } from '../model/types';

const words = (value: string): string => value.replace(/[_-]/g, ' ');

function heldReason(outcome: string): string | null {
  if (!outcome.startsWith('held:')) return null;
  return words(outcome.slice('held:'.length));
}

/** Required/actual outcome wording for people unfamiliar with the engine's typed outcome codes. */
export function plainOutcome(outcome: RequiredOutcome | string): string {
  const value = typeof outcome === 'string' ? outcome : outcome.kind === 'held' ? `held:${outcome.reason}` : outcome.kind;
  switch (value) {
    case 'reconciled':
      return 'complete the payment and match it to the bank acknowledgement';
    case 'supplier_committed':
      return 'save the approved supplier profile';
    case 'nonterminal':
      return 'reach a final outcome';
  }
  const reason = heldReason(value);
  if (reason) return `stop the case for ${reason}`;
  if (value.startsWith('settled:')) return `record ${value.slice('settled:'.length)} settlements for the same payment`;
  return words(value);
}

/** Lay explanation of a typed policy finding. The mechanism remains visible separately as the technical classification. */
export function plainFindingExplanation(finding: Pick<Finding, 'policyId' | 'mechanism'>): string {
  switch (finding.mechanism) {
    case 'unverified-destination':
      return 'A payment could use bank details without valid, currently applicable independent verification for this supplier.';
    case 'unbound-or-dependent-approval':
      return 'A payment could go through without a valid approval that applies to the exact payment and comes from an independent approver.';
    case 'dependent-approval-issued':
      return 'The payment preparer and approver are not sufficiently independent, so the approval does not provide a separate check.';
    case 'missing-clearance':
      return 'A payment could go through without valid onboarding clearance that applies to this supplier and case.';
    case 'unmatched-invoice':
      return 'A payment could go through even though the invoice was not successfully matched to its order and receipt.';
    case 'limit-exceeded-without-escalation':
      return 'A payment above the routine amount limit could go through without the required escalation approval.';
    case 'second-settlement':
      return 'The same payment obligation could be paid more than once.';
  }
  if (finding.mechanism.startsWith('unauthorized:')) return 'A person or service could perform an action that the company authorization rules do not allow.';
  if (finding.mechanism.startsWith('restricted-transfer:')) return 'Sensitive data could be sent to a system without the required recipient, purpose or field restrictions.';
  return `The model found a reachable execution that breaks policy ${finding.policyId}. See the technical details for the exact mechanism.`;
}

/** Lay explanation of a typed required-outcome failure. */
export function plainGoalFailureExplanation(failure: Pick<GoalFailure, 'kind' | 'required' | 'actual'>): string {
  const required = plainOutcome(failure.required);
  const actual = plainOutcome(failure.actual);
  switch (failure.kind) {
    case 'deadlock':
      return `The workflow gets stuck before it can ${required}: no next step is available.`;
    case 'legitimate_hold': {
      const reason = heldReason(failure.actual);
      return `A valid case that should ${required} is stopped instead${reason ? ` for ${reason}` : ''}.`;
    }
    case 'second_settlement':
      return `The same payment obligation is paid more than once, so the case cannot meet its required outcome: ${required}.`;
    case 'wrong_terminal':
      return `The workflow ends by trying to ${actual}, but it should ${required}.`;
  }
}
