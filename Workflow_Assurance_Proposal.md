# Workflow Assurance Lab
## A proof of concept for trustworthy workflow automation

**Discussion proposal for Anthony Saieva, AIVC**  
**Prepared by Manuel Hidalgo Solá | 6 October 2026**  
**Independent concept; fictional company and policies; not an implemented product**

### The opportunity

A company workflow graph can show what depends on what. The next useful question is what a proposed automation changes: which information becomes actionable, who gains execution authority, which controls disappear, and which new capabilities emerge when several workflows are automated together.

I propose a small assurance layer that compares automation designs before deployment. Its output is not a generic risk score. It is a concrete explanation of a newly possible policy violation, followed by a verified redesign and an explicit business-value comparison.

The inspiration is RogueOne's differential analysis of cross-trust-domain data flows between software versions. Here, the “update” is a change to how a company performs its work. The proposed extension tracks data meaning, permissions, exact evidence scope, and consequential actions. [1]

### The demonstration: supplier onboarding to payment

Use a fictional distributor with Procurement, Accounts Payable, Treasury, and Security. Model supplier requests, the supplier master, invoice matching, payment authorization, and a mock bank gateway. The central company rule is simple: a payment destination must have independent verification for the exact supplier and bank-details version.

The baseline has two verification mechanisms. Supplier maintenance verifies bank details before committing a change. Manual payment handling checks for valid evidence before release and obtains it when missing.

Automating supplier maintenance alone remains acceptable because the downstream payment check remains. Automating payment preparation/submission alone remains acceptable because supplier maintenance still establishes the required evidence. **Automating both can remove both mechanisms and create a new path from a supplier's unverified bank-detail claim to an executed payment.** An amount approver can remain in the process without fixing that specific failure.

The application should discover this interaction from its model, show the execution that demonstrates it, and identify the pair as a minimal enabling automation set.

### Three capabilities in one small prototype

| Capability | What the user sees |
|---|---|
| Semantic differential reachability | What newly becomes possible, with a feasible execution, the violated policy, and the evidence that is missing or invalid |
| Compositional analysis | Which automation combinations introduce a hazard absent from their individual configurations |
| Control synthesis | The least-cost verified repair within a small catalog, while preserving legitimate payment completion |

Potential repairs include restoring verification before supplier-master changes, adding a conditional independent-verification gate at payment release, or restoring human supplier maintenance. The engine applies and rechecks the repairs; it does not assume that inserting a “human review” box makes the design acceptable.

### Why this is useful

The result connects technical architecture to an operational recommendation: **automate these activities, preserve this boundary, verify these exceptions, and retain this estimated amount of business value.** Every recommendation exposes its assumptions and the exact controls it depends on.

For illustration only, assume 1,000 invoices and 100 supplier events per month. If only 60 supplier events lead to payment that month, a six-minute conditional verification step requires six extra human hours, versus ten hours for verifying every supplier event upfront. Whether that deferral is permitted is decided by the policy, not by the financial optimizer. These are synthetic inputs, not measured customer benefits.

Mandatory requirements remain hard constraints. The system cannot recommend “do not pay any invoices” as its safest option: legitimate cases must still complete. Reachability establishes possible behavior in the model, not the likelihood of a real incident.

### Deliberately narrow implementation

Build a single browser-based React and TypeScript application: fourteen activity templates, eight entity kinds, six company policies, three automation candidates, and six repair templates. Store the hypothetical knowledge graph in versioned JSON and run deterministic state exploration in a Web Worker. Use React Flow for the visual graph and structured panels for evidence, scenarios, repairs, and assumptions. Its documented custom-node and edge capabilities fit this interface. [2]

No graph database, backend, live banking connection, enterprise integration, or LLM dependency is needed for the demonstration. The app analyzes proposed designs; it does not execute business workflows or certify legal compliance.

### Deliverables and success criteria

The deliverable is a shareable browser demonstration, a documented fictional model and policy catalog, a reproducible analysis report, and tests for the main interaction and its repairs. The demonstration succeeds when it detects the combined-automation hazard, explains why each individual automation retained a safeguard, recommends a rechecked repair, and keeps legitimate cases operational.

A complete, passing result means no violation was found across the declared finite model and cases; it is not a proof about an unconstrained company or agent. Missing evidence and incomplete exploration must remain visible.

The planning estimate is 35–55 focused engineering hours for the scoped prototype. The first vertical slice is baseline → combined automation → violating execution → conditional verification → acceptable completion. Additional edge cases follow only after that slice works.

### Proposed discussion

The immediate question is whether AIVC's graph already distinguishes data transfers, effective permissions, and implemented controls, or primarily represents workflow dependencies. The prototype can establish the value of the analysis independently; a later adapter could map existing graph facts into the minimal model without requiring an infrastructure replacement.

### Sources

[1] Sofaer et al. *RogueOne: Detecting Rogue Updates via Differential Data-flow Analysis Using Trust Domains*. ICSE 2024. https://www.cs.columbia.edu/~junfeng/papers/rogueone-icse24.pdf

[2] xyflow. *React Flow: Quick Start*. https://reactflow.dev/learn
