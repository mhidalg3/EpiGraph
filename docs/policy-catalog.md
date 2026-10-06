# Policy catalog (stipulated company rules, not legal obligations)

| ID | Requirement | Monitored at | Hazard mechanisms |
|---|---|---|---|
| P01 | Executed destination has valid independent verification for the exact (supplier, bank version, account digest) | W11/W14 pre-execution state | `unverified-destination` |
| P02 | Valid approval covers the exact payment fingerprint and is independent of its preparer | W11/W14; approval issuance | `unbound-or-dependent-approval`, `dependent-approval-issued` |
| P03 | Principal, operation, resource, field and purpose satisfy the authorization table (deny overrides allow) | every action, evidence issuance and payment | `unauthorized:<operation>:<resource>` |
| P04 | Restricted fields leave a boundary only to an approved recipient, purpose and field set | every external transfer | `restricted-transfer:<system>` |
| P05 | Onboarding clearance, exact invoice-version match, amount within the USD 10,000.00 limit or explicit escalation | W11/W14 | `missing-clearance`, `unmatched-invoice`, `limit-exceeded-without-escalation` |
| P06 | At most one settlement per payment obligation across the permitted retry | W11/W14 | `second-settlement` |

Evidence semantics: beneficiary evidence binds `(supplierId, bankVersion, accountDigest)`; payment authorization binds `(paymentId, paymentVersion, invoiceId, invoiceVersion, supplierId, bankVersion, accountDigest, amountCents, currency)`. Independence uses the effective credential and the policy-scoped independence group, never labels.
