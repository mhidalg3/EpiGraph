# Workflow Assurance Lab
## Technical design and implementation proposal
### Supplier onboarding and invoice-to-payment proof of concept

**Prepared for:** Manuel Hidalgo Solá; discussion with Anthony Saieva, AIVC  
**Version:** 0.1 — 6 October 2026  
**Status:** Proposed design, not an implemented or evaluated product  
**Scope:** One fictional company, one connected process, three automation candidates

> **Design decision:** Build a browser-based React + TypeScript application. Store a typed knowledge graph in versioned JSON, compile it into a finite transition model, and run deterministic analysis in a Web Worker. Do not introduce a graph database, backend, native shell, or LLM dependency in the first demo.

## 1. Proposal and intended contribution

The demo should answer a concrete decision question: **Which supplier-management and payment activities can be automated together, what new behavior does that enable, and what is the least disruptive verified redesign?**

The proposed system is an assurance layer over a company workflow graph, not a workflow execution platform. A user selects automation candidates, sees changes to information access and execution authority, examines a policy-violating execution, and compares repairs that preserve business value.

The research inspiration is RogueOne's comparison of cross-trust-domain data flows across software versions. Here, the change under inspection is an automation design rather than a package update. The extension is to make the differential sensitive to data meaning, permission, evidence, object version, and consequential action. RogueOne is inspiration, not a claim that its implementation or guarantees transfer directly to this setting. [1]

The central hypothesis is that **semantic, compositional analysis can distinguish automation designs that look identical in an ordinary dependency graph**, and can expose hazards absent when the component automations are evaluated separately. Existing work already addresses governance-rule propagation over multi-input/multi-output graphs and logic-based multistage security analysis; the proposal is not that ontologies or graph reasoning are new. [2, 3]

### 1.1 What the demonstration must show

| Capability | User-visible result | Engineering requirement |
|---|---|---|
| Semantic differential reachability | A new path from an unverified bank-detail claim to payment execution | A feasible stateful witness, not just a connected graph path |
| Compositional analysis | Supplier maintenance and payment automation are individually acceptable but jointly unsafe in the fixture | Analyze all eight subsets of three candidates under identical assumptions |
| Control synthesis | A conditional beneficiary-verification gate repairs the design more cheaply than restoring every manual step | Apply each candidate repair, recheck the complete model, and compare explicit costs |
| Reproducible explanation | Every finding identifies its policy, evidence, changed design elements, and execution steps | Stable identifiers, provenance, deterministic exploration, and exportable reports |

### 1.2 Deliberate exclusions

There will be no real payment execution, bank connection, company discovery, natural-language policy ingestion, compliance certification, arbitrary agent simulation, free-form workflow editor, authentication, or multi-user collaboration. All companies, transactions, permissions, and operating assumptions are fictional. The policies are stipulated company rules, not representations of legal obligations.

The implementation should demonstrate one defensible vertical slice rather than a generalized enterprise ontology. Broad ontology languages, probabilistic calibration, and industrial-scale model checking are follow-on work.

## 2. The fictional company and baseline process

**Northstar** is a fictional B2B distributor. Its modeled organization has Procurement, Accounts Payable, Treasury, and Security. These units supply ownership and accountability context; department boundaries do not themselves grant permission or define independence.

The baseline uses a supplier inbox, a supplier-master system, invoice records, a deterministic purchase-order/receipt matcher, an approval service, and a mock bank gateway. The bank gateway is an approved external recipient for a narrowly defined payment payload. An optional external invoice-extraction service is approved for ordinary invoice fields, but not bank details or tax identifiers.

The model contains human principals for supplier maintenance, beneficiary verification, payment preparation, and payment approval, plus service principals for the three proposed automations. Verification and approval identities are explicitly separated from the relevant preparer/editor identities.

### 2.1 Activity inventory

These fourteen activity templates are the executable backbone. The graph view groups them into supplier management and invoice-to-payment lanes. Conditional activities need not run on every case.

| ID | Activity | Essential semantic effect |
|---|---|---|
| W01 | Receive supplier registration or change request | Create supplier-submitted claims; do not treat them as verified facts |
| W02 | Prepare supplier-master draft | Preserve claimed bank details and their source/version |
| W03 | Independently verify beneficiary before commit | On successful trusted-source validation, issue evidence for the exact supplier and bank version |
| W04 | Commit supplier-master version | Install a new version; never silently transfer old evidence to it |
| W05 | Accept or hold supplier profile | Record the fictional company's onboarding clearance independently of bank verification |
| W06 | Receive and extract invoice | Produce structured fields with field-level lineage and restrictions |
| W07 | Match invoice to order and receipt | Produce a match result for the exact invoice version |
| W08 | Prepare payment request | Snapshot supplier, invoice, bank version, account digest, amount, and currency |
| W09 | Check beneficiary evidence before release | Retain valid evidence or obtain independent verification when it is missing |
| W10 | Authorize payment request | Issue approval for the exact payment fingerprint; amount approval alone is not beneficiary verification |
| W11 | Submit payment through mock gateway | Record the actual payload and executing principal; evaluate action-bound policies |
| W12 | Reconcile bank acknowledgement | Complete a successfully paid case |
| W13 | Hold or reject an exception | Produce an explicit reason and disposition, not an unexplained dead end |
| W14 | Retry an uncertain submission | At most one modeled retry; use the same idempotency key |

Supplier-update and invoice branches may interleave where their prerequisites allow. There is no blanket rule that every supplier update must finish before every payment activity. A dedicated stale-approval fixture permits a bank-version change after preparation or approval. Both branches share versioned supplier state; they are not independently analyzed and then loosely merged.

### 2.2 The compositional example

The baseline has two opportunities to establish beneficiary verification: the supplier-maintenance path verifies before committing a bank change, and the manual payment path checks for valid evidence before release. The latter performs independent verification only when it is absent.

**A1 — Invoice extraction:** Replace manual extraction with a bounded extraction contract. It can produce incorrect claims but cannot create verification evidence or payment authority.

**A2 — Supplier maintenance:** Allow the supplier agent to commit a proposed master-record change without W03. This is not automatically a policy violation: the policy constrains payment execution, not every intermediate draft or unverified master record. The downstream manual W09 still prevents an unverified payment.

**A3 — Payment preparation and submission:** Automate W08 and W11 and remove the manual beneficiary-evidence check W09. Preserve the independent transaction authorization W10, the baseline payload-binding gateway check, and the baseline idempotency mechanism. This design relies on supplier maintenance having established valid beneficiary evidence.

With A2 alone, W09 still checks the changed beneficiary. With A3 alone, W03 still establishes valid evidence before the changed version is used. With A2 and A3 together, both mechanisms are absent: the system can authorize an amount and execute a payment to an unverified destination. A1 is not required for that hazard. This interaction is deliberately constructed as the flagship fixture, not asserted to describe a real company's process.

**Important:** The residual human at W10 does not automatically repair the problem. Its contract approves the amount and matched obligation, not the authenticity of bank details.

## 3. Representation: ontology, graph, policies, and execution

Use four distinct layers with a single canonical model. The ontology defines meaning; the knowledge graph instantiates facts; the policy layer defines obligations and prohibitions; the transition model defines what can happen.

The display graph is a projection of the canonical model. Do not separately maintain editable graph edges and executable rules that can silently diverge.

### 3.1 Minimal ontology: eight entity kinds

| Kind | Meaning | Required identifying semantics |
|---|---|---|
| OrgUnit | Ownership/accountability grouping | ID and name; no implicit access grants |
| Principal | Human, service, or external actor | ID, principal kind, effective security identity, independence group, evidence status |
| Role | Scoped organizational or technical function | ID and named responsibilities; grants remain explicit |
| System | Processing or execution environment | Administrative boundary, approved purposes, accepted field categories |
| Activity | Guarded business operation | Workflow ID, inputs, outputs, actor binding, operation contract |
| Asset | Versioned business information | Asset kind, object ID, version, fields, lineage, category, source |
| Evidence | Immutable attestation about an exact object or action | Kind, issuer, subject tuple, method, sources, validity, provenance |
| Control | Implemented restriction or verification step | Target, enforcement mode, guard/effect, issuer requirements, cost |

Asset kinds are a small closed vocabulary: supplier claim, supplier master, invoice, order/receipt match, payment request, and payment receipt. Evidence kinds are beneficiary verification, onboarding clearance, and payment authorization. Asset kinds are not independent graph node classes in the implementation.

Policies are separately versioned records. Workflow membership is an Activity property. Data categories, processing purposes, and operation names are controlled enumerations rather than extra graph nodes. Add concepts only when a fixture or policy needs them.

The provenance distinction among information, activities, and responsible actors is compatible with the conceptual separation in PROV-O, but the demo does not claim PROV-O or RDF conformance. [4]

### 3.2 Typed relationships

| Relationship | Direction and meaning | What must not be inferred |
|---|---|---|
| ACCOUNTABLE_FOR | OrgUnit → Activity | Ownership is not execution permission |
| HAS_ROLE / EXECUTES | Principal → Role / Activity | A role name does not imply an unrestricted capability |
| CAN_CALL | Principal → System, with operation and resource scope | A technical capability is not a company-policy authorization |
| CONSUMES / PRODUCES | Asset → Activity / Activity → Asset | Information cannot flow through an activity without its contract |
| TRANSFERS_TO | Activity → Activity, with payload fields and purpose | A timing dependency is not a data transfer |
| PRECEDES | Activity → Activity, with an explicit scheduling condition | Precedence does not carry data or authority |
| DERIVED_FROM | Derived Asset → Source Asset, with field mapping | Derivation does not increase integrity or remove restrictions |
| ATTESTS_TO | Evidence → exact Asset version or payment tuple | Approval of one version does not approve another |
| GUARDS | Control → Activity or API action | A documented control is not necessarily implemented or unavoidable |

Store complex transfers as contract records rather than oversized free-text edge labels. Render them as semantic edges in the user interface. Multi-input operations are explicit Activity nodes: all required inputs must be present in the same execution state with compatible object and version identities.

### 3.3 Canonical records and metadata

Every record has an ID, schema version, source reference, and evidence status: `fixture`, `observed`, `assumed`, or `unknown`. A complete fictional fixture uses `fixture`; that means stipulated truth inside the demonstration, not independently verified real-world evidence.

Each analysis is tied to an explicit analysis date, graph version, policy version, and engine version. Where expiry is modeled, validity is evaluated against that fixed date, not a hidden wall clock.

Use `effectiveIdentityId` to normalize aliases of the same credential. Use an explicit, policy-scoped `independenceGroup` and approved verifier bindings; different display names or roles are insufficient. Shared top-level company administration alone should not collapse every legitimate employee into one identity. Shared writable evidence or a reused credential is modeled explicitly as an independence problem.

The source of truth is a `ModelBundle`: entities, activity contracts, technical capability facts, policies, implemented controls, automation patches, case fixtures, and economic assumptions. Generate adjacency maps and display edges from this bundle.

## 4. Policy layer and semantic contracts

### 4.1 Separate ability, authorization, and enforcement

This separation is mandatory:

**Technical ability:** Which operations the actor can perform through the modeled interface. This helps define feasible transitions.

**Normative authorization:** Whether company policy permits that operation in the current context. Violations must remain observable; policy requirements are not automatically applied as execution guards.

**Implemented enforcement:** A real control in the hypothetical design that blocks or transforms an operation. Only these controls may remove a transition or route it into a blocked-attempt outcome.

Otherwise, a checker could assume the very property it is intended to test: requiring verification before exploring payment would make unverified payment unreachable by construction.

The fictional capability inventory is explicitly declared complete. In that inventory, an absent exact grant means the modeled API cannot perform the operation; an incomplete real-world inventory would instead require an unknown result. Normative authorization uses explicit principal/role, operation, resource/field, and purpose rules, with deny overriding allow and no matching allow meaning prohibited. Department ownership and role names never create a grant implicitly.

Unknown critical capabilities or control implementations prevent an affirmative assurance result. For v0, stop with a precise `unknown` report rather than inventing a grant, assuming a denial, or silently analyzing an incomplete fragment as complete.

### 4.2 Six company policies

| ID | Requirement | Check location |
|---|---|---|
| P01 Beneficiary integrity | The executed payment destination has valid independent verification for the exact supplier, bank version, and account digest | Actual W11 payload and pre-execution state |
| P02 Bound, independent approval | A valid approval covers the exact payment fingerprint and is independent of its preparer | W11; also inspect evidence issuance |
| P03 Authorized operation | The executing principal, operation, resource, and purpose satisfy the company's authorization table | Every modeled sensitive read, write, evidence issue, and payment action |
| P04 Restricted-data transfer | Restricted fields leave a boundary only to an approved recipient, for an approved purpose, within the permitted field set | Every data-transfer event |
| P05 Business prerequisites | The supplier has onboarding clearance, the invoice version is matched, and the amount is within the stipulated authorization limit or has an explicit escalation approval | W11 |
| P06 At-most-once settlement | A payment obligation is not settled more than once across the permitted retry | W11 and W14 |

An illustrative routine-payment limit of **USD 10,000** is a fixture parameter, not a statutory rule. Currency is explicit and the first model supports USD only. A required escalation without modeled evidence routes to a hold, not an inferred authorization.

### 4.3 Evidence and invalidation

Beneficiary evidence binds `(supplierId, bankVersion, accountDigest)`. It includes its issuer, method, source IDs, and validity. It is valid only when the issuer has the relevant authority, the issuer is independent of the bank-detail editor under P01, and the stipulated verification method uses an approved independent source.

The modeled trusted contact directory is not writable by either automation. Calling a telephone number supplied in the same untrusted change request is not independent verification. A human or agent assertion saying `verified: true` is not evidence.

Payment authorization binds `(paymentId, paymentVersion, invoiceId, invoiceVersion, supplierId, bankVersion, accountDigest, amount, currency)`. Changing a bound field changes the fingerprint. Evidence remains in the audit history, but it no longer satisfies the predicate for the changed object.

Issue attestations only through a small set of admitted operators with authorized issuer identities. Transformations and extraction agents cannot manufacture attestations. The demo models these rules symbolically; it does not implement real signatures or verify a bank's identity service.

### 4.4 Information semantics

Track confidentiality restrictions separately from integrity and provenance. An accurately extracted bank account can still be an unverified supplier claim. Verification establishes an integrity fact about an exact value; it does not make that value non-sensitive.

Extraction and summarization inherit the relevant input-field restrictions and source lineage. A summary of a full restricted document is not automatically sanitized. Explicit projection may omit particular fields before a transfer, while the internal process retains the originals. Approved purposes are intersected when multiple restricted inputs are combined; an empty compatible-purpose set prevents an authorized transfer.

The minimal transformation vocabulary is `copy`, `extract`, `projectFields`, `combine`, `propose`, `commitVersion`, `verify`, `authorize`, `execute`, and `hold`. These are fixed, reviewed operations, not arbitrary JavaScript uploaded through JSON.

### 4.5 Contract shape

```typescript
interface ActivityContract {
  id: string;
  workflowId: string;
  actorId: string;
  operation: Operation;
  inputs: ScopedInput[];       // AND: same state, object, case, version
  capabilityRequirements: CapabilityRequirement[];
  workflowPreconditions: PredicateExpr;
  implementedControlIds: string[];
  effects: EffectExpr[];
  sourceRef: string;
}
```

`PredicateExpr` is a small discriminated union: `all`, `any`, `not`, field equality, bounded comparison, and named evidence predicates. `EffectExpr` has fixed operations such as setting a finite field, creating a scoped asset, issuing an admitted attestation, recording a transfer, and updating a bounded counter. Semantic validation is separate from JSON shape validation.

Do not build a general policy language in v0. Policies can be named TypeScript monitor functions with declarative parameters in JSON; this preserves explicit semantics without writing a parser or theorem prover.

## 5. Formal model and semantic differential reachability

### 5.1 Finite transition system

Let a design `d = (A, C)` contain selected automation patches A and implemented control patches C. Compile the canonical model under that design into:

```text
M_d = (S_d, I_d, T_d)

S_d : finite states
I_d : initial states from the selected case fixtures
T_d : permitted operational transitions, including control outcomes
```

Each state contains workflow progress, versioned asset values, current evidence, actor bindings, transfer history sufficient for the policies, outstanding obligations, and bounded payment/retry counters. Store provenance and witness metadata outside the state key unless it changes future behavior or policy evaluation.

A transition is enabled when its workflow prerequisites and technical capabilities hold and its implemented controls allow it. Its required inputs must be jointly present in the same state. The transition applies typed effects and emits events; policy monitors inspect the actual events and resulting state.

The first model analyzes one supplier and one invoice per case, no more than two bank versions, one modeled update, and one retry. Permit at most one re-preparation and reauthorization after that update so C3 can preserve legitimate progress instead of merely blocking a stale request. Amounts use the finite categories needed for the policy boundary, with an exact amount retained in each fixture's fingerprint. Activities have finite progress/attempt counters; arbitrary loops and unbounded agent text are excluded.

A one-supplier model cannot establish safety for shared mutable state across many concurrent suppliers. That is an explicit assurance boundary, not an optimization hidden from the report.

### 5.2 Concrete semantic predicates

The following definitions pin down the main integrity check. `p` is the actual payment payload, `e` an evidence record in the current state, and `editor` the recorded editor of the referenced supplier-bank version.

```text
ValidBeneficiary(e, p, s) :=
    e.kind = beneficiaryVerification
    AND e.subject = (p.supplierId, p.bankVersion, p.accountDigest)
    AND e.issuer is authorized to verify this supplier scope
    AND Independent(e.issuer, editor(p.bankVersion), P01)
    AND e.method is admitted by P01
    AND e.sources satisfy P01's independent-source requirement
    AND e is valid at the fixed analysis date
    AND e was present initially as admitted evidence or issued
        by an admitted transition in this same execution prefix

Bad_P01(s, event) :=
    event.kind = paymentExecuted
    AND NOT EXISTS e IN s.evidence:
        ValidBeneficiary(e, event.actualPayload, s)

Enabled(s, t) :=
    WorkflowPreconditions(s, t)
    AND TechnicalCapabilityAvailable(s, t)
    AND ImplementedControlsAllow(s, t)
```

`ValidApproval` follows the same structure, replacing the subject with the full payment fingerprint and checking the approver against the payment preparer. The policy monitor must not be invoked as an implicit enabling guard. Negation over missing evidence is meaningful only after the fixture's evidence inventory and transition semantics have been declared complete.

### 5.3 What the engine checks

For each policy `p`, define a bad event/state predicate `Bad_p`. The safety question is:

```text
Does a feasible execution from I_d reach an event/state satisfying Bad_p?
```

Breadth-first exploration produces a shortest witness in number of modeled transitions. Use exact canonical state keys and a visited set. Evaluate every enabled activity and branch; do not only follow the visually highlighted or nominal path.

```text
queue := initial states
seen  := canonical keys of initial states

while queue is not empty:
    s := pop_front(queue)
    for each enabled transition t in deterministic order:
        (s2, events) := apply(t, s)
        check policies against (s, t, events, s2)
        record semantic-flow atoms and witness predecessors
        enqueue s2 if its canonical state key is new

if all states are exhausted:
    return a complete result for the stated finite model
else if a resource limit is reached:
    return partial/unknown coverage, never a clean pass
```

Check initial-state invariants as well. A policy cannot be treated as satisfied simply because its consequential action is never exercised; business-goal checks address that separately.

Do not globally union facts from unrelated branches. That would invent executions, combine incompatible versions, and create false witnesses. Positive semantic facts may be derived to a fixed point within one state; changing state and invalidating evidence require the transition semantics rather than monotone rule accumulation alone.

### 5.4 Differential semantics

For each reached event, emit a normalized semantic atom containing source lineage/category, destination boundary or consequential operation, purpose, authority level, relevant verification state, and policy scope. Its fields must come from one feasible execution state, not independently reachable facts.

Let `F(M)` be the set of these atoms. Compare the same cases and policy set:

```text
New flows       = F(M_candidate) - F(M_baseline)
Removed flows   = F(M_baseline)  - F(M_candidate)
Retained flows  = intersection of the two sets
```

A new atom might read: `supplier-claimed bank details -> payment.execute; beneficiaryEvidence=missing`. Even when the graph endpoints are unchanged, an edge's change from recommendation to executable instruction or from verified to unverified use can produce a meaningful differential.

Use stable business identifiers in signatures and exclude incidental traversal order. A display-name change must not become a new security finding. Keep the underlying scoped IDs and versions in each witness so normalization does not erase object identity during the actual analysis.

Separately compare policy findings: introduced, persistent, and resolved. An unsafe baseline is reported as unsafe; the absence of a new violation does not make the candidate acceptable. Increased frequency or financial exposure on an already-reachable behavior belongs in the economic/risk layer, not in an invented new-flow count.

### 5.5 Example witness

```text
1. Supplier submits bank destination B for supplier S.
2. A2 commits supplier-master version v1 containing B.
3. The invoice is matched and payment P is prepared against v1.
4. Independent W10 approval authorizes the exact amount/payload.
5. A3 submits P to the mock bank gateway without W09.
6. P01 fails: no valid independent evidence covers (S, v1, B).
```

This is a possible execution in the hypothetical model, not a prediction that fraud will happen. The witness must identify the missing control and enabling patches, as well as the policy violation.

### 5.6 Assurance statement and implementation limits

A complete exploration with no violation establishes that no bad event is reachable **in this finite transition model, with these cases, contracts, assumptions, and policies**, assuming the engine and compiler are correct. It does not prove a real company compliant, a language model honest, or an arbitrary agent safe.

The proposed TypeScript checker is not itself formally verified. Counterexample replay, mutation tests, deterministic state canonicalization, and independently specified expected cases are required engineering checks. A reproducibility hash is not a cryptographic attestation of correctness.

The behavior scope is declared workflow contracts and explicitly modeled failure actions, not every action a compromised agent could take with a general-purpose tool. Separately display technical capability excesses; do not label them as witnessed workflow executions. A later capability-level threat model can expand the transition set.

## 6. Compositional analysis

For three binary candidates, analyze all `2^3 = 8` subsets with the same case suite and baseline controls. Show the results as a compact matrix, not just three independent automation scores.

| Selected candidates | Expected P01 result in flagship fixture | Explanation |
|---|---|---|
| None | No violation | Baseline verification mechanisms remain |
| A1 | No violation | Extraction does not confer authority or verification |
| A2 | No violation | Manual W09 establishes or checks evidence before release |
| A3 | No violation | Baseline W03 establishes evidence before the master version is used |
| A1 + A2 | No violation | Same retained downstream verification as A2 |
| A1 + A3 | No violation | Same retained upstream verification as A3 |
| A2 + A3 | Violation | Both mechanisms establishing beneficiary verification are absent |
| A1 + A2 + A3 | Violation | The same cross-workflow hazard remains |

These are expected fixture outcomes and acceptance criteria, not reported experimental results.

For hazard identity `h`, compute the inclusion-minimal unsafe sets:

```text
U_h = { A : h is reachable under A,
            and h is not reachable under any proper subset of A }
```

In this example, `{A2, A3}` is the minimal enabling automation set. All proper subsets must actually be checked. Do not assume safety or risk is monotone in automation count: an automation can also remove a path or introduce a control.

Keep distinct concepts separate: a shortest execution witness, a minimal automation set, and a minimum-cost repair are three different objects. One does not establish the others.

Shared identity and evidence are part of the composition model. Two agents using one effective credential do not become independent authorizers. Likewise, multiple checks reading the same unsupported supplier claim do not create independent verification.

## 7. Control synthesis and optimization

### 7.1 Six finite control templates

A control is an executable model patch with preconditions, costs, and a stated enforcement point. It is not a label placed on a diagram.

| ID | Candidate repair | What the patch changes |
|---|---|---|
| C1 | Restore precommit beneficiary verification | Require independent W03 evidence before W04 commits the changed bank version |
| C2 | Conditional verification at payment gateway | Route missing/invalid beneficiary evidence to an independent verifier, then enforce exact evidence binding before W11 |
| C3 | Bind and revalidate payment authorization | Snapshot the payload and reject version/fingerprint mismatch; route legitimate changes through preparation and approval again |
| C4 | Project restricted fields before external extraction | Transfer only approved invoice fields; retain bank/tax processing internally |
| C5 | Restore human supplier-maintenance execution | Remove the agent's direct master-write capability and restore the human verified commit path; account for lost A2 benefit |
| C6 | Enforce settlement idempotency | Use a payment-obligation key at the gateway so the modeled retry cannot create a second settlement |

C3 and C6 already exist in the baseline and in the flagship automation design; dedicated mutation fixtures remove them. A selected control that is already present is a no-op, not an extra repair or an extra cost. C4 only applies to the optional external-processing design.

C2 must include both a feasible source of independent verification and an unavoidable enforcement point. Adding a review box, trusting an agent-produced summary, or guarding only the normal path does not count. A threshold-only approval also cannot satisfy a policy requiring beneficiary verification at every amount.

### 7.2 Exact finite search before optimization libraries

For a fixed requested automation set, there are at most `2^6 = 64` control combinations. Across all eight automation subsets, there are at most 512 raw combinations before applicability checks and deduplication. That is a deliberately small design space.

Enumerate compatible control sets, apply each to the original design, recompile, and rerun the policy and business-goal checks. Cache by canonical model/policy/case/design hash. For rejecting an infeasible repair, one confirmed counterexample is sufficient. For accepting one, the relevant exploration must complete.

This avoids a premature dependency on an SMT or integer-programming solver. Later, a counterexample-guided hitting-set method can propose controls, but a cover of already-discovered paths is not sufficient: repaired designs must still be rechecked for bypasses and newly introduced behavior.

### 7.3 Prevent the trivial solution: stop everything

A design is feasible only if it passes policy checks **and** preserves the required business behavior. Legitimate fixture cases must still complete payment and reconciliation; invalid-change cases must be held or rejected with the correct reason; no reachable nonterminal deadlock may be introduced.

The finite model has bounded attempts and no unbounded waiting loops. Check all terminal outcomes for each case and detect nonterminal states with no successor. This is a finite progress test under the modeled workflow behavior, not a guarantee about real human response times or production liveness.

Required review volume must also fit the stipulated human-capacity budget. Holding every invoice or disabling every payment edge is not an acceptable low-risk repair.

### 7.4 Least-disruptive repair objective

For fixed requested automations A, rank only feasible repairs by monthly value lost relative to the requested design:

```text
D(A, C) = lost capacity-equivalent benefit
        + additional recurring control cost
        + incremental setup cost / amortization months
```

Then break ties by fewer changed workflow/capability elements. Keep review-capacity and any explicitly modeled service limits as constraints rather than hiding them in arbitrary weights. A user can change the economic assumptions; all recommendations must show which values were used.

A repair is **minimum-cost within this finite control catalog and these assumptions** only when the required candidate search and verification complete. Otherwise report `best verified candidate found`, with the remaining search coverage. Unknown cheaper candidates prevent an optimality claim.

Controls can interact economically. For example, C1 and C2 may cause the same case to be verified once, not twice. Compute cost from the repaired workflow and case mix rather than adding independent control penalties blindly.

### 7.5 Joint automation selection

For the broader comparison, choose both A and C:

```text
maximize V(A, C)
subject to:
    no reachable violation of any hard policy;
    required terminal outcomes and no modeled deadlocks;
    human-review capacity within budget;
    all critical assumptions explicit and complete.
```

For case class s, let `N_s` be monthly volume, `m0_s` baseline human minutes, `m_s(A,C)` repaired-design human minutes, and `r` the value of a human hour. The v0 objective is:

```text
V(A,C) = (r / 60) * sum_s N_s * [m0_s - m_s(A,C)]
         - operatingCost(A,C)
         - setupCost(A,C) / T
```

Use a fixed, explicit nominal operating route for economic calculations, separate from adversarial safety exploration. Charge overlapping controls only for the activities that actually occur. Do not average arbitrary BFS paths or use their relative counts as business frequencies.

This is capacity-equivalent value, not necessarily realized cash savings. Do not claim a throughput or queueing improvement from summed task-time savings; a real bottleneck model would be a separate extension.

### 7.6 Worked economics — entirely synthetic

Assume 1,000 invoices and 100 new/changed supplier records per month, with 60 of those supplier events leading to payment in the month. A1 saves 5 minutes per invoice; A2 saves 8 minutes per supplier event; A3 saves 4 minutes per invoice. These savings are stipulated net reductions for disjoint modeled work, not measurements.

Gross capacity freed is `5,000 + 800 + 4,000 = 9,800 minutes`, or **163.33 hours/month**. At a hypothetical USD 60/hour, that is USD 9,800 of monthly capacity-equivalent benefit. Deduct USD 700 of recurring automation cost and USD 3,600 of setup cost amortized over 12 months: **USD 8,800/month before repair**. The unsafe design is ineligible regardless of its apparent value.

| Design | Added/returned human work | Added monthly control cost | Illustrative net value | Eligibility in flagship case |
|---|---|---|---|---|
| A1 + A2 + A3, no repair | None | None | USD 8,800 | Ineligible: P01 violation |
| Add C1 | 100 verifications × 6 min = 10 h | USD 40 | USD 8,160 | Expected feasible |
| Add C2 | 60 verifications × 6 min = 6 h | USD 80 | USD 8,360 | Expected feasible |
| Restore human master maintenance with C5 | Return A2's 13.33 h of work | USD 0 incremental | USD 8,000 | Expected feasible |

For this illustration, the original platform costs remain fixed when C5 is used, and no extra setup costs are assigned to these three repairs. C2 defers verification for supplier records not yet used for a payment; it is acceptable only because the fictional policy permits an unverified intermediate master record and requires verification at payment. A stricter onboarding policy would change the feasible set.

With a review budget of eight extra hours per month, C2 fits and C1 does not. The table establishes arithmetic under assumptions, not model-checker results, control effectiveness measurements, or an ROI forecast for AIVC or a client.

### 7.7 What “risk” means in v0

Reachability is a possibility statement, not a probability. Report the violated policy, hazard mechanism, affected case classes, authority expansion, and possible consequence. Do not produce an unexplained numerical risk score or treat path counts as independent failure opportunities.

If calibrated probabilities are later available, a soft-risk term can be introduced as `R(A,C) = E_z[Loss(A,C,z)]` over explicit joint scenarios z, including common-cause failures. Do not multiply independent failure probabilities for reviewers that share evidence, credentials, or a model. Hard policies remain constraints rather than being traded against expected savings.

For the demo, show optional low/base/high sensitivity assumptions only as user-entered scenarios. Leave probability-based risk and expected-loss-adjusted optimization disabled by default.

## 8. Application architecture and concrete stack

### 8.1 Browser app, not native app

Choose a single-page web app because the output is an interactive graph, a scenario comparison, and a report that can be demonstrated in a browser. A native shell, mobile UI, or desktop packaging adds no necessary capability to this scope.

Use TypeScript rather than untyped JavaScript: entity kinds, policy predicates, evidence tuples, and result statuses benefit from discriminated unions and exhaustive handling. This is a design choice, not a claim that the type system establishes policy correctness.

| Layer | Choice | Why it is included |
|---|---|---|
| UI | React + TypeScript + Vite | One familiar application package and fast local development |
| Graph canvas | React Flow (`@xyflow/react`) | Custom nodes/edges, typed interactions, inspectors, and witness highlighting [6] |
| Layout | Fixed hand-authored positions | Fourteen activities do not justify an auto-layout dependency |
| Styling/state | Plain CSS, CSS variables, React reducer/context | Avoid unnecessary UI and state-management frameworks |
| Model input | Versioned JSON + Zod | Runtime shape validation plus inferred TypeScript types; add domain validation separately [8] |
| Reasoning | Pure TypeScript modules | Explicit state exploration, finite design enumeration, deterministic explanations |
| Background execution | Native Web Worker | Keep graph interaction responsive; Vite supports worker bundling [7] |
| Persistence | Bundled fixtures + JSON import/export | No database or backend; optional small localStorage settings only |
| Tests | Vitest, fast-check, Playwright | Unit/mutation tests, generative invariants, and browser demo checks [9–11] |
| Deployment | Static build | Serve the built assets; no application server or secret keys |

React Flow is the visualization component, not the inference engine. Vite transpiles TypeScript but does not itself perform full type checking; run `tsc --noEmit` in the build/test workflow. [6, 7]

### 8.2 No knowledge-graph database in v0

A knowledge graph is the typed representation and its semantics, not necessarily a database product. Keep it in JSON with in-memory maps indexed by entity ID, activity, operation, input asset, and capability scope.

A graph database could later support persistent company-scale facts, multi-user updates, graph queries, and integration. It would not eliminate the need to implement version-sensitive evidence, feasible workflow execution, differential semantics, or control synthesis. The first demo gains little from provisioning Neo4j or an RDF store.

Similarly, SHACL validates RDF graphs against declared conditions; that is different from establishing the temporal/execution properties required here. Revisit RDF/SHACL only when interoperability warrants it. [5]

### 8.3 Dataflow through the app

```text
Bundled/imported ModelBundle
        -> shape + semantic validation
        -> automation/control patch application
        -> compiled finite transition model
        -> worker: exploration + differential + composition + synthesis
        -> structured AnalysisReport
        -> graph projection + findings + repair/value comparison
        -> JSON/Markdown report export
```

The UI never decides whether a design is acceptable. It renders the engine's structured status. Cosmetic edits such as node positions are stored separately from semantic model data.

Do not run an LLM in the first version. Use templates for findings and explanations. A later language model may propose facts or draft explanations, but must not invent evidence, mutate policies, or override deterministic results.

### 8.4 Suggested repository

```text
src/
  model/       types.ts  schemas.ts  ontology.ts  validate.ts
  fixtures/    northstar.json  cases.json  assumptions.json
  engine/      compile.ts  capabilities.ts  evidence.ts
               transitions.ts  policies.ts  explore.ts
               differential.ts  composition.ts  synthesis.ts
               value.ts  witness.ts  canonicalize.ts
  workers/     reasoner.worker.ts
  ui/          WorkflowCanvas.tsx  Inspector.tsx
               ScenarioPanel.tsx  FindingsPanel.tsx
               RepairComparison.tsx  CoverageBanner.tsx
  App.tsx
tests/
  model/       engine/       mutations/       e2e/
docs/
  design.md    policy-catalog.md    demo-script.md
```

Use one package and one lockfile. Pin the supported Node runtime and dependency versions when scaffolding, rather than leaving the project on moving `latest` dependencies.

```bash
npm create vite@latest workflow-assurance-lab -- --template react-ts
cd workflow-assurance-lab
npm install @xyflow/react zod
npm install -D vitest fast-check @playwright/test
npx playwright install chromium
```

After scaffolding, commit the lockfile, enable strict TypeScript options, and add separate scripts for type checking, tests, and production build. There is no database setup step.

### 8.5 Engine interfaces

```typescript
analyze(bundle, design, caseIds, limits): AnalysisReport
compare(bundle, baseline, candidate, caseIds, limits): DiffReport
analyzeComposition(bundle, candidateIds, caseIds, limits): CompositionReport
synthesize(bundle, requestedDesign, objective, limits): SynthesisReport
replayWitness(bundle, design, witness): WitnessReplayResult
```

Keep the engine independent of React and the DOM. All input is serializable. Worker messages include a request ID; discard stale responses after a scenario changes. Cancellation may terminate and recreate the worker for the first implementation. Never leave the UI displaying an old green result for a newly edited design.

## 9. User experience and report contract

### 9.1 One screen, four tasks

The left panel selects a baseline, automation toggles, case suite, and economic assumptions. The center shows a grouped workflow canvas. The right inspector explains the selected transfer, actor capability, evidence requirement, or control. A bottom results panel has Findings, Composition, and Repairs tabs.

Keep dependency, data-flow, and authority overlays visually distinct. Use text badges and line styles as well as color. Selecting a finding highlights the exact witness and opens its ordered steps; keyboard users must also be able to inspect it as a table without operating the graph.

The default graph should show the activity backbone and only the assets/controls needed for the selected finding. Do not render every ontology fact simultaneously as a dense network.

### 9.2 Result statuses

Keep analysis coverage, policy result, and business-goal result separate:

| Field | Values | Meaning |
|---|---|---|
| analysisStatus | `complete`, `partial`, `invalid` | Whether exploration finished and inputs were admissible |
| policyStatus | `satisfied_in_model`, `violated`, `unknown` | Whether modeled policy requirements hold |
| goalStatus | `satisfied`, `failed`, `unknown` | Whether required business outcomes are preserved |
| optimizationStatus | `optimal_in_catalog`, `best_verified_found`, `no_feasible_design`, `unknown` | What the finite repair search established |

Use a green state only for complete analysis with satisfied policies and business goals. A confirmed violating witness remains useful even if later exploration hits a limit; the report can say `violated` with partial coverage. A missing witness from an incomplete run is not a pass.

Export the model/design hashes, versions, case IDs, known assumptions, limits, explored-state counts, policy findings, witness steps, control patches, cost assumptions, and optimality coverage. Hashes establish reproducibility of inputs, not trusted certification.

### 9.3 Performance and import limits

Proposed limits are 100 entities, 150 displayed relations, 14 activity templates, 3 automation candidates, and 6 repair templates. Each case remains within the finite scope stated in Section 5. Set configurable guards of 25,000 states and 250,000 explored transitions per case; exceeding either produces an explicit incomplete result.

Target sub-second analysis for the small flagship fixture and a few seconds for its repair search on the development laptop. These are performance targets to measure, not existing benchmark results. Show progress and allow cancellation; do not precompute every global combination on every keystroke.

Reject malformed references, unsupported operations, invalid evidence subjects, conflicting patches, duplicate semantic IDs, and oversized imports. Render imported strings as text, never HTML. Do not accept arbitrary executable expressions or service credentials in fixtures.

## 10. Verification plan and acceptance criteria

Build tests before visual polish. Expected policy results must be independently specified, not copied from whatever the engine happens to return.

| Test or mutation | Expected outcome |
|---|---|
| Baseline; valid routine invoice | Completes and satisfies all modeled policies |
| A2 alone / A3 alone | Each remains acceptable in the flagship case |
| A2 + A3 | Produces the P01 witness; identifies `{A2,A3}` as minimal enabling set |
| A2 + A3 + C2 | Valid changed-beneficiary case completes; invalid change is held |
| Human amount review retained, no beneficiary verification | Still flags P01; no automatic trust from a human node |
| Old verification evidence reused for a new bank version | Evidence is invalid for the changed version |
| Payload changes after approval with binding enforcement removed | Flags P02; C3 repairs and routes valid cases through reapproval |
| Two approval aliases share an effective identity | Rejects claimed independence under the policy |
| Restricted raw fields sent to external extractor | Flags P04; proper projection prevents that transfer |
| Summary made from restricted fields without projection | Restrictions remain; summarization is not declassification |
| Retry without gateway idempotency | Flags P06; C6 prevents second settlement |
| Different-case or different-version evidence merged | No invented evidence satisfaction or cross-branch witness |
| Remove all payment capability or hold all invoices | Safety may hold, but legitimate business-goal checks fail |
| Pre-existing baseline violation | Reported as persistent; not hidden by differential logic |
| Unknown critical grant/control metadata | Returns unknown/invalid assurance rather than guessing |
| State cap reached | Partial coverage; never `satisfied_in_model` |
| Rename a display label or reorder JSON records | Same normalized semantic result |
| Replay a saved counterexample | Every step is enabled and the stated policy fails |

Generative tests should exercise ID renaming, record ordering, version changes, independent versus shared identities, and harmless graph additions. Fast-check supports property-based testing in the JavaScript/TypeScript ecosystem; it is a testing aid, not a proof of engine correctness. [11]

Three Playwright flows are sufficient initially: baseline analysis, introduction of the compositional hazard, and repair selection with updated value and coverage. Vitest covers the pure engine and fixture expectations. [9, 10]

**Release gate:** All named fixtures pass their independently specified outcomes; the main witness is replayable; every recommended repair is rechecked; a progress failure cannot be presented as acceptable; incomplete search cannot be presented as minimum cost. No accuracy percentage should be advertised from this small hand-authored test suite.

## 11. Build plan and stopping rule

The planning estimate is **35–55 focused engineering hours** for one developer under this constrained design. It is not an implementation-time measurement or a delivery guarantee.

| Milestone | Estimated effort | Exit criterion |
|---|---|---|
| 1. Model and baseline | 6–8 h | Canonical schema, fourteen activity contracts, first legitimate/invalid cases |
| 2. Stateful checker | 10–14 h | Evidence/version semantics, policy monitors, replayable P01 witness, progress checks |
| 3. Differential and composition | 5–8 h | Before/after semantic atoms, eight-subset analysis, minimal unsafe set |
| 4. Repairs and value | 6–10 h | Finite repair enumeration, repaired-model rechecks, explicit economic comparison |
| 5. Browser demonstration and QA | 8–15 h | Canvas, inspectors, coverage states, report export, end-to-end checks |

The first end-to-end slice is baseline → A2+A3 → P01 witness → C2 → valid completion. Add external-transfer and retry mutations only after this slice is correct. Build the UI against fixture-backed report structures while the pure engine is developed, but never substitute canned verdicts for the final demo's analysis.

Stop expanding the scope when the app can explain that slice, prove the pairwise interaction within the finite model, choose between C1/C2/C5 using explicit costs, and export a reproducible result. Additional ontology classes, graph products, agent frameworks, and deployment infrastructure do not improve that core demonstration.

## 12. Demonstration script and discussion with Anthony

**Minute 1:** Show Northstar's baseline process and state the two explicit beneficiary-verification mechanisms. Inspect one transfer's payload, purpose, actor, and evidence requirement.

**Minute 2:** Enable A2, then A3 separately. Show why the retained mechanism makes each design acceptable under the modeled case suite.

**Minute 3:** Enable both. Select the new P01 finding and replay the execution from supplier claim to bank submission. Point out that independent amount approval still exists but does not verify the beneficiary.

**Minute 4:** Run synthesis. Compare restoring precommit verification, inserting conditional release verification, and restoring human supplier maintenance. Select C2 and re-run; demonstrate both valid payment and rejection of an invalid change.

**Minute 5:** Change the monthly review budget or supplier-event mix. Show how the preferred feasible design changes without changing the policy semantics. Open the report's assumptions and finite-scope assurance statement.

The next integration question is whether AIVC's actual workflow graph already distinguishes data transfer, operational dependency, effective permissions, and implemented control evidence. The concept can be discussed without assuming a particular AIVC database or requiring access to client information.

## References

The external sources below support the architectural foundations and library capabilities. All company rules, model choices, numerical assumptions, test expectations, and proposed algorithms in this document are design decisions for this proof of concept. Documentation was checked on 6 October 2026.

[1] Raphael J. Sofaer, Yaniv David, Mingqing Kang, Jianjia Yu, Yinzhi Cao, Junfeng Yang, Jason Nieh. *RogueOne: Detecting Rogue Updates via Differential Data-flow Analysis Using Trust Domains*. ICSE 2024. https://www.cs.columbia.edu/~junfeng/papers/rogueone-icse24.pdf

[2] Rui Zhao, Malcolm Atkinson, Petros Papapanagiotou, Federica Magnoni, Jacques Fleuriot. *Dr.Aid: Supporting Data-governance Rule Compliance for Decentralized Collaboration in an Automated Way*. 2021. https://arxiv.org/abs/2110.01056

[3] Xinming Ou, Sudhakar Govindavajhala, Andrew W. Appel. *MulVAL: A Logic-based Network Security Analyzer*. USENIX Security 2005. https://www.usenix.org/conference/14th-usenix-security-symposium/mulval-logic-based-network-security-analyzer

[4] W3C. *PROV-O: The PROV Ontology*. https://www.w3.org/TR/prov-o/

[5] W3C. *Shapes Constraint Language (SHACL)*. https://www.w3.org/TR/shacl/

[6] xyflow. *React Flow: Quick Start*. https://reactflow.dev/learn

[7] Vite. *Features: TypeScript and Web Workers*. https://vite.dev/guide/features.html

[8] Zod. *Introduction*. https://zod.dev/

[9] Vitest. *Getting Started*. https://vitest.dev/guide/

[10] Microsoft. *Playwright: Installation*. https://playwright.dev/docs/intro

[11] fast-check. *Introduction*. https://fast-check.dev/docs/introduction/
