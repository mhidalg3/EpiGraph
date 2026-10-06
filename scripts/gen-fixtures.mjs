// Source of the bundled fixture JSON: `node scripts/gen-fixtures.mjs` regenerates src/fixtures/{northstar,cases,assumptions}.json.
import fs from 'fs';

// ---------- builders ----------
const lit = (value) => ({ ref: 'lit', value });
const fact = (key) => ({ ref: 'fact', key });
const env = (key) => ({ ref: 'env', key });
const actor = { ref: 'actor' };
const policy = (policyId, key) => ({ ref: 'policy', policyId, key });
const A = (kind, select = 'latest') => ({ kind, select: select === 'latest' ? 'latest' : { fact: select } });
const field = (kind, name, select = 'latest') => ({ ref: 'field', asset: A(kind, select), name });
const ver = (kind, select = 'latest') => ({ ref: 'version', asset: A(kind, select) });
const eq = (left, right) => ({ op: 'equals', left, right });
const cmp = (left, c, right) => ({ op: 'compare', left, cmp: c, right });
const all = (...args) => ({ op: 'all', args });
const any = (...args) => ({ op: 'any', args });
const not = (arg) => ({ op: 'not', arg });
const ev = (name, target) => ({ op: 'evidence', name, target });
const exists = (kind, select = 'latest') => ({ op: 'exists', asset: A(kind, select) });
const done = (id) => fact(`done.${id}`);
const doneGE = (id, n = 1) => cmp(done(id), 'gte', lit(n));
const doneZero = (id) => eq(done(id), lit(0));
const fr = (kind, name, select = 'latest') => ({ asset: A(kind, select), name });
const setFact = (key, value) => ({ op: 'setField', target: { kind: 'fact', key }, value });
const action = (operation, resource, fields, purpose) => ({ op: 'recordAction', operation, resource, fields, purpose });
const hold = (reason) => [setFact('hold.pending', lit(true)), setFact('hold.reason', lit(reason))];

const meta = (id, sourceRef, evidenceStatus = 'fixture') => ({ id, schemaVersion: '1.0.0', sourceRef, evidenceStatus });
const DM = 'master-draft';
const DRAFT = 'draft.version';
const CUR = 'master.current';

// ---------- entities ----------
const entities = [];
const org = (id, name) => entities.push({ ...meta(id, 'Design §2'), kind: 'OrgUnit', name });
org('ORG-PROC', 'Procurement');
org('ORG-AP', 'Accounts Payable');
org('ORG-TREASURY', 'Treasury');
org('ORG-SEC', 'Security');

const role = (id, name, responsibilities) => entities.push({ ...meta(id, 'Design §2'), kind: 'Role', name, responsibilities });
role('ROLE-INTAKE', 'Supplier request intake', ['Receive supplier registration and change requests']);
role('ROLE-SUPPLIER-MAINTAINER', 'Supplier maintainer', ['Prepare and commit supplier-master versions']);
role('ROLE-BENEFICIARY-VERIFIER', 'Beneficiary verifier', ['Independently verify bank details against a trusted source']);
role('ROLE-ONBOARDING-CLEARER', 'Onboarding clearer', ['Accept or hold supplier profiles']);
role('ROLE-INVOICE-CLERK', 'Invoice clerk', ['Extract, match and escalate invoice exceptions']);
role('ROLE-PAYMENT-PREPARER', 'Payment preparer', ['Prepare, submit, retry and reconcile payments']);
role('ROLE-PAYMENT-APPROVER', 'Payment approver', ['Authorize the exact payment fingerprint']);
role('ROLE-AUTOMATION-AGENT', 'Automation agent', ['Bounded service acting under an explicit activity contract']);
role('ROLE-SUPPLIER-EXTERNAL', 'External supplier', ['Submit registration or change requests']);

const principal = (id, name, principalKind, ident, group, roleIds, orgUnitId) =>
  entities.push({ ...meta(id, 'Design §2'), kind: 'Principal', name, principalKind, effectiveIdentityId: ident, independenceGroup: group, roleIds, ...(orgUnitId ? { orgUnitId } : {}) });
principal('P-PROC', 'Procurement intake officer', 'human', 'ID-P-PROC', 'G-PROC', ['ROLE-INTAKE'], 'ORG-PROC');
principal('P-MAINT', 'Supplier maintenance clerk', 'human', 'ID-P-MAINT', 'G-MAINT', ['ROLE-SUPPLIER-MAINTAINER'], 'ORG-AP');
principal('P-VERIFIER', 'Beneficiary verifier', 'human', 'ID-P-VERIFIER', 'G-VERIFY', ['ROLE-BENEFICIARY-VERIFIER'], 'ORG-TREASURY');
principal('P-CLEARER', 'Onboarding clearer', 'human', 'ID-P-CLEARER', 'G-CLEAR', ['ROLE-ONBOARDING-CLEARER'], 'ORG-SEC');
principal('P-AP-CLERK', 'Invoice clerk', 'human', 'ID-P-AP-CLERK', 'G-APCLERK', ['ROLE-INVOICE-CLERK'], 'ORG-AP');
principal('P-PAYOPS', 'Payment preparer / submitter', 'human', 'ID-P-PAYOPS', 'G-PAYOPS', ['ROLE-PAYMENT-PREPARER'], 'ORG-AP');
principal('P-APPROVER', 'Payment approver', 'human', 'ID-P-APPROVER', 'G-APPROVE', ['ROLE-PAYMENT-APPROVER'], 'ORG-TREASURY');
principal('SVC-EXTRACT', 'A1 invoice-extraction agent', 'service', 'ID-SVC-EXTRACT', 'G-SVC-EXTRACT', ['ROLE-AUTOMATION-AGENT'], 'ORG-AP');
principal('SVC-SUPPLIER', 'A2 supplier-maintenance agent', 'service', 'ID-SVC-SUPPLIER', 'G-SVC-SUPPLIER', ['ROLE-AUTOMATION-AGENT'], 'ORG-AP');
principal('SVC-PAYMENT', 'A3 payment agent', 'service', 'ID-SVC-PAYMENT', 'G-SVC-PAYMENT', ['ROLE-AUTOMATION-AGENT'], 'ORG-AP');
principal('EXT-SUPPLIER', 'Supplier (external requester)', 'external', 'ID-EXT-SUPPLIER', 'G-EXT', ['ROLE-SUPPLIER-EXTERNAL']);

const system = (id, name, boundary, approvedPurposes, acceptedCategories, approvedFields) =>
  entities.push({ ...meta(id, 'Design §2'), kind: 'System', name, boundary, approvedPurposes, acceptedCategories, ...(approvedFields ? { approvedFields } : {}) });
system('SYS-INBOX', 'Supplier inbox', 'internal', ['supplier-onboarding', 'supplier-maintenance'], ['bank', 'tax']);
system('SYS-MASTER', 'Supplier master', 'internal', ['supplier-maintenance', 'payment-execution', 'onboarding-review'], ['bank', 'tax']);
system('SYS-INVOICE', 'Invoice records', 'internal', ['invoice-processing', 'invoice-extraction'], ['bank', 'tax']);
system('SYS-MATCHER', 'Purchase-order / receipt matcher', 'internal', ['invoice-processing'], []);
system('SYS-APPROVAL', 'Approval service', 'internal', ['payment-preparation', 'payment-authorization', 'exception-handling'], ['bank']);
system('SYS-GATEWAY', 'Mock bank gateway', 'external', ['payment-execution', 'payment-reconciliation'], ['bank'], ['paymentId', 'supplierId', 'bankVersion', 'accountDigest', 'amountCents', 'currency', 'obligationId', 'invoiceId']);
system('SYS-DIRECTORY', 'Trusted contact directory (read-only)', 'internal', ['beneficiary-verification'], ['bank']);
system('SYS-EXTRACTOR', 'Invoice extraction service', 'internal', ['invoice-extraction'], ['bank', 'tax']);

const ACT = {
  W01: ['Receive supplier registration or change request', 'supplier', 'ORG-PROC', false, 'Create supplier-submitted claims; never verified facts.'],
  W02: ['Prepare supplier-master draft', 'supplier', 'ORG-AP', false, 'Preserve claimed bank details and their source/version.'],
  W03: ['Independently verify beneficiary before commit', 'supplier', 'ORG-TREASURY', false, 'Issue evidence for the exact supplier and bank version on trusted-source validation.'],
  W04: ['Commit supplier-master version', 'supplier', 'ORG-AP', false, 'Install a new immutable version; old evidence never transfers.'],
  W05: ['Accept or hold supplier profile', 'supplier', 'ORG-SEC', true, 'Record onboarding clearance independently of bank verification.'],
  W06: ['Receive and extract invoice', 'invoice', 'ORG-AP', false, 'Structured fields with field-level lineage and restrictions.'],
  W07: ['Match invoice to order and receipt', 'invoice', 'ORG-AP', false, 'Match result for the exact invoice version.'],
  W08: ['Prepare payment request', 'invoice', 'ORG-AP', false, 'Snapshot supplier, invoice, bank version, digest, amount, currency.'],
  W09: ['Check beneficiary evidence before release', 'invoice', 'ORG-TREASURY', true, 'Retain valid evidence or obtain independent verification when missing.'],
  W10: ['Authorize payment request', 'invoice', 'ORG-TREASURY', false, 'Approval for the exact payment fingerprint; not beneficiary verification.'],
  W11: ['Submit payment through mock gateway', 'invoice', 'ORG-AP', false, 'Record the actual payload and executing principal.'],
  W12: ['Reconcile bank acknowledgement', 'invoice', 'ORG-AP', false, 'Complete a successfully paid case.'],
  W13: ['Hold or reject an exception', 'invoice', 'ORG-AP', true, 'Explicit reason and disposition, not an unexplained dead end.'],
  W14: ['Retry an uncertain submission', 'invoice', 'ORG-AP', true, 'At most one retry with the same idempotency key.'],
};
for (const [id, [name, lane, ownerOrgUnitId, conditional, summary]] of Object.entries(ACT))
  entities.push({ ...meta(id, `Design §2.1 ${id}`), kind: 'Activity', name, workflowId: lane === 'supplier' ? 'supplier-management' : 'invoice-to-payment', lane, ownerOrgUnitId, conditional, summary });

const assetEnt = (id, name, assetKind, description) => entities.push({ ...meta(id, 'Design §3.1'), kind: 'Asset', name, assetKind, description });
assetEnt('AST-CLAIM', 'Supplier claim', 'supplierClaim', 'Untrusted supplier-submitted claim (unverified).');
assetEnt('AST-MASTER', 'Supplier master', 'supplierMaster', 'Versioned supplier master record with bank details and editor.');
assetEnt('AST-INVOICE', 'Invoice', 'invoice', 'Invoice document and extracted structured fields with lineage.');
assetEnt('AST-MATCH', 'Order/receipt match', 'orderReceiptMatch', 'Deterministic match result for the exact invoice version.');
assetEnt('AST-PAYMENT', 'Payment request', 'paymentRequest', 'Snapshot of the exact payment tuple.');
assetEnt('AST-RECEIPT', 'Payment receipt', 'paymentReceipt', 'Acknowledgement-backed reconciliation record.');

const evEnt = (id, name, evidenceKind, subjectFields, description) => entities.push({ ...meta(id, 'Design §4.3'), kind: 'Evidence', name, evidenceKind, subjectFields, description });
evEnt('EVD-BENEFICIARY', 'Beneficiary verification', 'beneficiaryVerification', ['supplierId', 'bankVersion', 'accountDigest'], 'Binds (supplierId, bankVersion, accountDigest).');
evEnt('EVD-CLEARANCE', 'Onboarding clearance', 'onboardingClearance', ['supplierId'], 'Supplier onboarding clearance, independent of bank verification.');
evEnt('EVD-APPROVAL', 'Payment authorization', 'paymentAuthorization', ['paymentId', 'paymentVersion', 'invoiceId', 'invoiceVersion', 'supplierId', 'bankVersion', 'accountDigest', 'amountCents', 'currency'], 'Binds the full payment fingerprint; escalation is a flag on this evidence.');

const ctl = (id, name, mode, description, extra = {}) => entities.push({ ...meta(id, 'Design §7.1'), kind: 'Control', name, mode, implemented: true, description, ...extra });
ctl('C1', 'Precommit beneficiary verification', 'guard', 'W04 may commit only with valid independent beneficiary evidence for the draft bank version.', { guard: ev('validBeneficiary', 'draft') });
ctl('C2', 'Conditional verification at the payment gateway', 'guard', 'W11/W14 require valid beneficiary evidence for the exact payload; missing evidence routes to independent verification.', {
  guard: ev('validBeneficiary', 'payload'),
  onBlock: [{ reason: 'no valid independent beneficiary evidence for the exact payload', effects: [setFact('gate.{activity}.blocked', lit(true)), setFact('done.W09', lit(0))] }],
});
ctl('C3', 'Payload / version / fingerprint binding', 'guard', 'Reject stale snapshot, current-version or approval-fingerprint mismatches; route legitimate changes through one re-preparation and reauthorization.', {
  guard: ev('payloadBound', 'payload'),
  onBlock: [
    { when: cmp(fact('reprep.count'), 'lt', lit(1)), reason: 'payload/version/fingerprint mismatch: re-prepare and reauthorize', effects: [setFact('done.W08', lit(0)), setFact('done.W09', lit(0)), setFact('done.W10', lit(0)), { op: 'incrementCounter', key: 'reprep.count', by: 1 }] },
    { reason: 'binding mismatch after the permitted re-preparation', effects: hold('payment_binding_failed') },
  ],
});
ctl('C4', 'Project restricted fields before external extraction', 'transform', 'Only approved invoice fields leave the boundary; bank/tax and restricted-derived fields are projected away.', { projectAwayUnacceptedCategories: true });
ctl('C6', 'Settlement idempotency by obligation key', 'idempotent', 'The gateway keys settlement by payment obligation; a retry of a settled obligation returns the prior receipt.');

// ---------- contracts ----------
const cap = (system, operation, resource) => ({ system, operation, resource });
const C = (id, actorId, operation, o) => ({
  ...meta(id, `Design §2.1 ${id}`),
  workflowId: ACT[id][1] === 'supplier' ? 'supplier-management' : 'invoice-to-payment',
  actorId,
  operation,
  inputs: o.inputs ?? [],
  capabilityRequirements: o.caps ?? [],
  workflowPreconditions: o.pre,
  implementedControlIds: o.controls ?? [],
  effects: o.effects ?? [],
  branches: o.branches,
});
const br = (id, effects, extra = {}) => ({ id, nominal: true, minutes: 0, verification: false, effects, ...extra });
const input = (kind, role, select = 'latest') => ({ asset: A(kind, select), role });

const supplierPending = all(doneGE('W01'), doneZero('W04'));
const draftSel = DRAFT;
const poolPurposes = ['supplier-maintenance', 'payment-execution'];
const claimField = (name, valueRef, categories, purposes) => ({ name, value: valueRef, lineage: ['supplier-claim'], categories, purposes });

const W01 = C('W01', 'P-PROC', 'copy', {
  caps: [cap('SYS-INBOX', 'read', 'supplierClaim')],
  pre: all(eq(env('supplierChange'), lit(true)), doneZero('W01'), doneZero('W11')),
  branches: [
    br('receive', [
      {
        op: 'createAsset', kind: 'supplierClaim', objectId: env('supplierId'), version: lit(1), status: 'received',
        fields: [
          claimField('accountDigest', env('claimDigest'), ['bank'], poolPurposes),
          claimField('taxId', env('claimTaxId'), ['tax'], ['supplier-maintenance']),
          claimField('accountName', env('claimName'), [], ['supplier-maintenance']),
        ],
      },
      action('receive', 'supplierClaim', ['accountDigest', 'taxId', 'accountName'], 'supplier-onboarding'),
    ]),
  ],
});

const W02 = C('W02', 'P-MAINT', 'propose', {
  inputs: [input('supplierClaim', 'claim')],
  caps: [cap('SYS-INBOX', 'read', 'supplierClaim'), cap('SYS-MASTER', 'write', 'supplierMaster')],
  pre: all(doneGE('W01'), doneZero('W02')),
  branches: [
    br('draft', [
      {
        op: 'createAsset', kind: 'supplierMaster', objectId: env('supplierId'), version: fact('bank.next'), status: 'draft',
        fields: [
          { name: 'supplierId', value: env('supplierId'), lineage: ['supplier-claim'], categories: [], purposes: poolPurposes },
          { name: 'accountDigest', value: field('supplierClaim', 'accountDigest'), categories: [], purposes: poolPurposes },
          { name: 'taxId', value: field('supplierClaim', 'taxId'), categories: [], purposes: ['supplier-maintenance'] },
          { name: 'editor', value: actor, lineage: ['editor'], categories: [], purposes: poolPurposes },
        ],
      },
      setFact(DRAFT, fact('bank.next')),
      { op: 'incrementCounter', key: 'bank.next', by: 1 },
      action('draft', 'supplierMaster', ['accountDigest', 'taxId'], 'supplier-maintenance'),
    ], { minutes: 1 }),
  ],
});

const dirDigestMatchesDraft = eq(env('directoryDigest'), field('supplierMaster', 'accountDigest', draftSel));
const W03 = C('W03', 'P-VERIFIER', 'verify', {
  inputs: [input('supplierMaster', 'draft', draftSel)],
  caps: [cap('SYS-DIRECTORY', 'read', 'contactDirectory')],
  pre: all(doneGE('W02'), doneZero('W03')),
  branches: [
    br('verified', [
      action('read', 'contactDirectory', [], 'beneficiary-verification'),
      { op: 'issueEvidence', kind: 'beneficiaryVerification', subject: 'draft', method: env('verificationMethod'), sources: [env('verificationSource')], validDays: 365 },
    ], { when: dirDigestMatchesDraft, minutes: 6, verification: true }),
    br('mismatch', [action('read', 'contactDirectory', [], 'beneficiary-verification'), ...hold('beneficiary_verification_failed')], { when: not(dirDigestMatchesDraft), nominal: false }),
  ],
});

const W04 = C('W04', 'P-MAINT', 'commitVersion', {
  inputs: [input('supplierMaster', 'draft', draftSel)],
  caps: [cap('SYS-MASTER', 'write', 'supplierMaster')],
  controls: ['C1'],
  pre: all(doneGE('W02'), doneZero('W04')),
  branches: [
    br('commit', [
      { op: 'setField', target: { kind: 'asset', asset: A('supplierMaster', draftSel), name: 'status' }, value: lit('committed') },
      setFact(CUR, fact(DRAFT)),
      action('commit', 'supplierMaster', ['accountDigest'], 'supplier-maintenance'),
    ], { minutes: 1 }),
  ],
});

const W05 = C('W05', 'P-CLEARER', 'verify', {
  caps: [cap('SYS-MASTER', 'read', 'supplierMaster')],
  pre: all(doneZero('W05'), not(ev('hasClearance', 'supplier')), any(not(eq(env('supplierChange'), lit(true))), doneGE('W01'))),
  branches: [
    br('cleared', [
      action('read', 'supplierMaster', [], 'onboarding-review'),
      { op: 'issueEvidence', kind: 'onboardingClearance', subject: 'supplier', method: lit('onboarding-review'), sources: [lit('SYS-MASTER')], validDays: 365 },
    ], { when: eq(env('clearanceOk'), lit(true)) }),
    br('held', [action('read', 'supplierMaster', [], 'onboarding-review'), ...hold('onboarding_not_cleared')], { when: not(eq(env('clearanceOk'), lit(true))), nominal: false }),
  ],
});

const invFields = ['invoiceId', 'supplierRef', 'amountCents', 'currency', 'lineItems', 'orderRef'];
const extractTransferFields = (extra) => [...invFields, ...extra].map((n) => fr('invoice', n));
const W06_MANUAL = C('W06', 'P-AP-CLERK', 'extract', {
  inputs: [input('invoice', 'document')],
  caps: [cap('SYS-INVOICE', 'read', 'invoice')],
  pre: all(eq(env('hasInvoice'), lit(true)), doneZero('W06')),
  branches: [
    br('extract_correct', [
      { op: 'setField', target: { kind: 'asset', asset: A('invoice'), name: 'extractedAmountCents' }, value: field('invoice', 'amountCents') },
      action('extract', 'invoice', ['amountCents'], 'invoice-processing'),
    ], { minutes: 5 }),
  ],
});
const W06_A1 = C('W06', 'SVC-EXTRACT', 'extract', {
  inputs: [input('invoice', 'document')],
  caps: [cap('SYS-INVOICE', 'read', 'invoice'), cap('SYS-EXTRACTOR', 'extract', 'invoice')],
  pre: all(eq(env('hasInvoice'), lit(true)), doneZero('W06')),
  branches: [
    br('extract_correct', [
      { op: 'recordTransfer', to: 'SYS-EXTRACTOR', purpose: 'invoice-extraction', fields: extractTransferFields(['remitBankAccount', 'remitTaxId']) },
      { op: 'setField', target: { kind: 'asset', asset: A('invoice'), name: 'extractedAmountCents' }, value: field('invoice', 'amountCents') },
      action('extract', 'invoice', ['amountCents'], 'invoice-processing'),
    ]),
    br('extract_correct_via_summary', [
      { op: 'setField', target: { kind: 'asset', asset: A('invoice'), name: 'summaryText' }, value: lit('invoice-summary'), derivedFrom: [fr('invoice', 'remitBankAccount'), fr('invoice', 'remitTaxId'), fr('invoice', 'lineItems')] },
      { op: 'recordTransfer', to: 'SYS-EXTRACTOR', purpose: 'invoice-extraction', fields: extractTransferFields(['summaryText']) },
      { op: 'setField', target: { kind: 'asset', asset: A('invoice'), name: 'extractedAmountCents' }, value: field('invoice', 'amountCents') },
      action('extract', 'invoice', ['amountCents'], 'invoice-processing'),
    ]),
    br('extract_mismatch', [
      { op: 'recordTransfer', to: 'SYS-EXTRACTOR', purpose: 'invoice-extraction', fields: extractTransferFields(['remitBankAccount', 'remitTaxId']) },
      { op: 'setField', target: { kind: 'asset', asset: A('invoice'), name: 'extractedAmountCents' }, value: lit(1) },
      action('extract', 'invoice', ['amountCents'], 'invoice-processing'),
    ], { nominal: false }),
  ],
});

const amountMatches = eq(field('invoice', 'extractedAmountCents'), env('orderAmountCents'));
const matchAsset = (result) => ({
  op: 'createAsset', kind: 'orderReceiptMatch', objectId: env('invoiceId'), version: ver('invoice'), status: 'matched',
  fields: [{ name: 'result', value: lit(result), lineage: ['matcher'], categories: [], purposes: ['invoice-processing'] }],
});
const W07 = C('W07', 'P-AP-CLERK', 'combine', {
  inputs: [input('invoice', 'invoice')],
  caps: [cap('SYS-MATCHER', 'match', 'orderReceiptMatch')],
  pre: all(doneGE('W06'), doneZero('W07')),
  branches: [
    br('match', [matchAsset('match'), action('match', 'orderReceiptMatch', [], 'invoice-processing')], { when: amountMatches }),
    br('mismatch', [matchAsset('mismatch'), action('match', 'orderReceiptMatch', [], 'invoice-processing'), ...hold('invoice_mismatch')], { when: not(amountMatches), nominal: false }),
  ],
});

const payFieldPurposes = ['payment-execution'];
const pf = (name, value) => ({ name, value, lineage: ['payment-snapshot'], categories: [], purposes: payFieldPurposes });
const W08_PRE = all(doneGE('W06'), doneGE('W07'), doneZero('W08'), exists('supplierMaster', CUR), eq(field('orderReceiptMatch', 'result'), lit('match')), ev('hasClearance', 'supplier'));
const W08_EFFECTS = [
  {
    op: 'createAsset', kind: 'paymentRequest', objectId: env('paymentId'), version: fact('payment.next'), status: 'prepared',
    fields: [
      pf('paymentId', env('paymentId')),
      pf('invoiceId', field('invoice', 'invoiceId')),
      pf('invoiceVersion', ver('invoice')),
      pf('supplierId', field('supplierMaster', 'supplierId', CUR)),
      pf('bankVersion', ver('supplierMaster', CUR)),
      { name: 'accountDigest', value: field('supplierMaster', 'accountDigest', CUR), categories: [], purposes: payFieldPurposes },
      { name: 'amountCents', value: field('invoice', 'extractedAmountCents'), categories: [], purposes: payFieldPurposes },
      pf('currency', field('invoice', 'currency')),
      pf('obligationId', env('obligationId')),
      pf('preparerId', actor),
    ],
  },
  { op: 'incrementCounter', key: 'payment.next', by: 1 },
  action('prepare', 'paymentRequest', ['amountCents', 'accountDigest'], 'payment-preparation'),
];
const W08 = (actorId) =>
  C('W08', actorId, 'propose', {
    inputs: [input('invoice', 'invoice'), input('supplierMaster', 'master', CUR), input('orderReceiptMatch', 'match')],
    caps: [cap('SYS-APPROVAL', 'write', 'paymentRequest')],
    pre: W08_PRE,
    branches: [br('prepare', W08_EFFECTS, { minutes: 3 })],
  });

const livePayload = ev('validBeneficiary', 'payload');
const digestMatchesLive = eq(env('directoryDigest'), field('supplierMaster', 'accountDigest', CUR));
const verifyOk = [
  action('read', 'contactDirectory', [], 'beneficiary-verification'),
  { op: 'issueEvidence', kind: 'beneficiaryVerification', subject: 'committed', method: env('verificationMethod'), sources: [env('verificationSource')], validDays: 365 },
];
const verifyFail = [action('read', 'contactDirectory', [], 'beneficiary-verification'), ...hold('beneficiary_verification_failed')];
const W09_MANUAL = C('W09', 'P-VERIFIER', 'verify', {
  inputs: [input('paymentRequest', 'payment')],
  caps: [cap('SYS-DIRECTORY', 'read', 'contactDirectory')],
  pre: all(doneGE('W08'), doneZero('W09')),
  branches: [
    br('retain', [], { when: livePayload }),
    br('verify_ok', verifyOk, { when: all(not(livePayload), digestMatchesLive), minutes: 6, verification: true }),
    br('verify_fail', verifyFail, { when: all(not(livePayload), not(digestMatchesLive)), nominal: false }),
  ],
});
const W09_C2 = C('W09', 'P-VERIFIER', 'verify', {
  inputs: [input('paymentRequest', 'payment')],
  caps: [cap('SYS-DIRECTORY', 'read', 'contactDirectory')],
  pre: all(doneGE('W08'), doneZero('W09'), not(livePayload), any(eq(fact('gate.W11.blocked'), lit(true)), eq(fact('gate.W14.blocked'), lit(true)))),
  branches: [
    br('verify_ok', verifyOk, { when: digestMatchesLive, minutes: 6, verification: true }),
    br('verify_fail', verifyFail, { when: not(digestMatchesLive), nominal: false }),
  ],
});

const amount = field('paymentRequest', 'amountCents');
const limit = policy('P05', 'limitCents');
const authEffect = (escalation) => ({ op: 'issueEvidence', kind: 'paymentAuthorization', subject: 'payment', method: lit('payment-approval'), sources: [lit('SYS-APPROVAL')], escalation: lit(escalation), validDays: 365 });
const W10_BRANCHES = [
  br('approve_routine', [action('authorize', 'paymentRequest', [], 'payment-authorization'), authEffect(false)], { when: cmp(amount, 'lte', limit) }),
  br('approve_escalated', [action('authorize', 'paymentRequest', [], 'payment-authorization'), authEffect(true)], { when: all(cmp(amount, 'gt', limit), eq(env('escalationApproved'), lit(true))) }),
  br('hold_escalation_required', [action('authorize', 'paymentRequest', [], 'payment-authorization'), ...hold('escalation_required')], { when: all(cmp(amount, 'gt', limit), not(eq(env('escalationApproved'), lit(true)))), nominal: false }),
];
const W10 = (pre) =>
  C('W10', 'P-APPROVER', 'authorize', {
    inputs: [input('paymentRequest', 'payment')],
    caps: [cap('SYS-APPROVAL', 'authorize', 'paymentRequest')],
    pre,
    branches: W10_BRANCHES,
  });
const W10_MANUAL = W10(all(doneGE('W08'), doneGE('W09'), doneZero('W10')));
const W10_A3 = W10(all(doneGE('W08'), doneZero('W10')));

const W11 = (actorId) =>
  C('W11', actorId, 'execute', {
    inputs: [input('paymentRequest', 'payment')],
    caps: [cap('SYS-GATEWAY', 'submit', 'payment')],
    controls: ['C3', 'C6'],
    pre: all(doneGE('W10'), doneZero('W11'), exists('supplierMaster', CUR)),
    branches: [
      br('ack_ok', [setFact('ack', lit('ok'))], { minutes: 1 }),
      br('ack_uncertain', [setFact('ack', lit('uncertain'))], { nominal: false }),
    ],
  });

const W12 = C('W12', 'P-PAYOPS', 'commitVersion', {
  inputs: [input('paymentRequest', 'payment')],
  caps: [cap('SYS-GATEWAY', 'read', 'paymentReceipt')],
  pre: all(eq(fact('ack'), lit('ok')), doneZero('W12'), not(supplierPending)),
  branches: [
    br('reconcile', [
      {
        op: 'createAsset', kind: 'paymentReceipt', objectId: env('paymentId'), version: lit(1), status: 'reconciled',
        fields: [{ name: 'obligationId', value: env('obligationId'), lineage: ['gateway-ack'], categories: [], purposes: ['payment-reconciliation'] }],
      },
      action('reconcile', 'paymentReceipt', [], 'payment-reconciliation'),
      { op: 'setDisposition', disposition: 'reconciled' },
    ]),
  ],
});

const W13 = C('W13', 'P-AP-CLERK', 'hold', {
  caps: [cap('SYS-APPROVAL', 'hold', 'exception')],
  pre: all(eq(fact('hold.pending'), lit(true)), doneZero('W13')),
  branches: [br('hold', [action('hold', 'exception', [], 'exception-handling'), { op: 'setDisposition', disposition: 'held', reason: fact('hold.reason') }])],
});

const W14 = C('W14', 'P-PAYOPS', 'execute', {
  inputs: [input('paymentRequest', 'payment')],
  caps: [cap('SYS-GATEWAY', 'submit', 'payment')],
  controls: ['C3', 'C6'],
  pre: all(eq(fact('ack'), lit('uncertain')), doneZero('W14')),
  branches: [br('ack_ok', [setFact('ack', lit('ok'))])],
});

const W03_ENSURE = W03;
const contracts = [W01, W02, W03, W04, W05, W06_MANUAL, W07, W08('P-PAYOPS'), W09_MANUAL, W10_MANUAL, W11('P-PAYOPS'), W12, W13, W14];

// ---------- capabilities & authorization ----------
let gid = 0;
const grant = (principalId, system, operation, resource, id) => ({ ...meta(id ?? `G-${principalId}-${system}-${operation}-${resource}`.slice(0, 64), 'Design §4.1'), principalId, system, operation, resource });
const capabilities = [
  grant('P-PROC', 'SYS-INBOX', 'read', 'supplierClaim'),
  grant('P-MAINT', 'SYS-INBOX', 'read', 'supplierClaim'),
  grant('P-MAINT', 'SYS-MASTER', 'write', 'supplierMaster'),
  grant('P-VERIFIER', 'SYS-DIRECTORY', 'read', 'contactDirectory'),
  grant('P-CLEARER', 'SYS-MASTER', 'read', 'supplierMaster'),
  grant('P-AP-CLERK', 'SYS-INVOICE', 'read', 'invoice'),
  grant('P-AP-CLERK', 'SYS-MATCHER', 'match', 'orderReceiptMatch'),
  grant('P-AP-CLERK', 'SYS-APPROVAL', 'hold', 'exception'),
  grant('P-PAYOPS', 'SYS-APPROVAL', 'write', 'paymentRequest'),
  grant('P-PAYOPS', 'SYS-GATEWAY', 'submit', 'payment', 'G-PAYOPS-SUBMIT'),
  grant('P-PAYOPS', 'SYS-GATEWAY', 'read', 'paymentReceipt'),
  grant('P-APPROVER', 'SYS-APPROVAL', 'authorize', 'paymentRequest'),
];
void gid;

const rule = (id, effect, principalIds, roleIds, operations, resources, purposes, fields) => ({ ...meta(id, 'Design §4.1'), effect, principalIds, roleIds, operations, resources, purposes, ...(fields ? { fields } : {}) });
const authorization = [
  rule('R-INTAKE-RECEIVE', 'allow', [], ['ROLE-INTAKE'], ['receive'], ['supplierClaim'], ['supplier-onboarding']),
  rule('R-MAINT-WRITE', 'allow', [], ['ROLE-SUPPLIER-MAINTAINER'], ['draft', 'commit'], ['supplierMaster'], ['supplier-maintenance']),
  rule('R-VERIFIER-READ', 'allow', [], ['ROLE-BENEFICIARY-VERIFIER'], ['read'], ['contactDirectory'], ['beneficiary-verification']),
  rule('R-VERIFIER-EVIDENCE', 'allow', [], ['ROLE-BENEFICIARY-VERIFIER'], ['issueEvidence'], ['evidence:beneficiaryVerification'], ['evidence-issuance']),
  rule('R-CLEARER-READ', 'allow', [], ['ROLE-ONBOARDING-CLEARER'], ['read'], ['supplierMaster'], ['onboarding-review']),
  rule('R-CLEARER-EVIDENCE', 'allow', [], ['ROLE-ONBOARDING-CLEARER'], ['issueEvidence'], ['evidence:onboardingClearance'], ['evidence-issuance']),
  rule('R-CLERK-INVOICE', 'allow', [], ['ROLE-INVOICE-CLERK'], ['extract', 'match'], ['invoice', 'orderReceiptMatch'], ['invoice-processing']),
  rule('R-CLERK-HOLD', 'allow', [], ['ROLE-INVOICE-CLERK'], ['hold'], ['exception'], ['exception-handling']),
  rule('R-PREPARER-PREPARE', 'allow', [], ['ROLE-PAYMENT-PREPARER'], ['prepare'], ['paymentRequest'], ['payment-preparation']),
  rule('R-PREPARER-EXECUTE', 'allow', [], ['ROLE-PAYMENT-PREPARER'], ['execute'], ['gateway:payment'], ['payment-execution']),
  rule('R-PREPARER-RECONCILE', 'allow', [], ['ROLE-PAYMENT-PREPARER'], ['reconcile'], ['paymentReceipt'], ['payment-reconciliation']),
  rule('R-APPROVER-AUTHORIZE', 'allow', [], ['ROLE-PAYMENT-APPROVER'], ['authorize'], ['paymentRequest'], ['payment-authorization']),
  rule('R-APPROVER-EVIDENCE', 'allow', [], ['ROLE-PAYMENT-APPROVER'], ['issueEvidence'], ['evidence:paymentAuthorization'], ['evidence-issuance']),
];

// ---------- policies ----------
const pol = (id, name, requirement, params) => ({ ...meta(id, 'Design §4.2'), name, requirement, params });
const policies = [
  pol('P01', 'Beneficiary integrity', 'The executed payment destination has valid independent verification for the exact supplier, bank version, and account digest.', { verifierRoleIds: ['ROLE-BENEFICIARY-VERIFIER'], admittedMethods: ['callback-trusted-directory'], trustedSources: ['SYS-DIRECTORY'] }),
  pol('P02', 'Bound, independent approval', 'A valid approval covers the exact payment fingerprint and is independent of its preparer.', { approverRoleIds: ['ROLE-PAYMENT-APPROVER'] }),
  pol('P03', 'Authorized operation', 'Executing principal, operation, resource and purpose satisfy the authorization table.', {}),
  pol('P04', 'Restricted-data transfer', 'Restricted fields leave a boundary only to an approved recipient, for an approved purpose, within the permitted field set.', {}),
  pol('P05', 'Business prerequisites', 'Onboarding clearance, exact invoice-version match, and amount within limit or explicit escalation.', { limitCents: 1000000, clearanceRoleIds: ['ROLE-ONBOARDING-CLEARER'] }),
  pol('P06', 'At-most-once settlement', 'A payment obligation is not settled more than once across the permitted retry.', { maxSettlements: 1 }),
];

// ---------- automations ----------
const patch = (id, label, description, ops, sourceRef) => ({ ...meta(id, sourceRef), label, description, patch: ops });
const automations = [
  patch('A1', 'A1 — Invoice extraction', 'Bind W06 to the extraction agent with bounded extraction branches; no authority to issue attestations.', [
    { op: 'setContract', contract: W06_A1 },
    { op: 'addCapability', grant: grant('SVC-EXTRACT', 'SYS-INVOICE', 'read', 'invoice', 'G-SVCEXT-INVOICE-READ') },
    { op: 'addCapability', grant: grant('SVC-EXTRACT', 'SYS-EXTRACTOR', 'extract', 'invoice', 'G-SVCEXT-EXTRACT') },
    { op: 'addAuthRule', rule: rule('R-SVCEXT-EXTRACT', 'allow', ['SVC-EXTRACT'], [], ['extract'], ['invoice'], ['invoice-processing']) },
  ], 'Design §2.2 A1'),
  patch('A2', 'A2 — Supplier maintenance', 'Bind W02/W04 to the supplier agent with scoped master writes; removes W03 and the W04 precommit requirement.', [
    { op: 'setActor', id: 'W02', actorId: 'SVC-SUPPLIER' },
    { op: 'setActor', id: 'W04', actorId: 'SVC-SUPPLIER' },
    { op: 'removeContract', id: 'W03' },
    { op: 'removeControl', id: 'W04', controlId: 'C1' },
    { op: 'addCapability', grant: grant('SVC-SUPPLIER', 'SYS-INBOX', 'read', 'supplierClaim', 'G-SVCSUP-CLAIM-READ') },
    { op: 'addCapability', grant: grant('SVC-SUPPLIER', 'SYS-MASTER', 'write', 'supplierMaster', 'G-SVCSUP-MASTER-WRITE') },
    { op: 'addCapability', grant: grant('SVC-SUPPLIER', 'SYS-DIRECTORY', 'read', 'contactDirectory', 'G-SVCSUP-DIRECTORY-READ') },
    { op: 'addAuthRule', rule: rule('R-SVCSUP-WRITE', 'allow', ['SVC-SUPPLIER'], [], ['draft', 'commit'], ['supplierMaster'], ['supplier-maintenance']) },
  ], 'Design §2.2 A2'),
  patch('A3', 'A3 — Payment preparation and submission', 'Bind W08/W11 to the payment agent; removes the manual W09 beneficiary check; retains W10, C3 and C6.', [
    { op: 'setActor', id: 'W08', actorId: 'SVC-PAYMENT' },
    { op: 'setActor', id: 'W11', actorId: 'SVC-PAYMENT' },
    { op: 'removeContract', id: 'W09' },
    { op: 'setPrecondition', id: 'W10', expr: W10_A3.workflowPreconditions },
    { op: 'addCapability', grant: grant('SVC-PAYMENT', 'SYS-APPROVAL', 'write', 'paymentRequest', 'G-SVCPAY-PREPARE') },
    { op: 'addCapability', grant: grant('SVC-PAYMENT', 'SYS-GATEWAY', 'submit', 'payment', 'G-SVCPAY-SUBMIT') },
    { op: 'addCapability', grant: grant('SVC-PAYMENT', 'SYS-APPROVAL', 'authorize', 'paymentRequest', 'G-SVCPAY-APPROVAL-READ') },
    { op: 'addAuthRule', rule: rule('R-SVCPAY-PREPARE', 'allow', ['SVC-PAYMENT'], [], ['prepare'], ['paymentRequest'], ['payment-preparation']) },
    { op: 'addAuthRule', rule: rule('R-SVCPAY-EXECUTE', 'allow', ['SVC-PAYMENT'], [], ['execute'], ['gateway:payment'], ['payment-execution']) },
  ], 'Design §2.2 A3'),
];

// ---------- repairs ----------
const rep = (id, label, description, ops, applicability = {}) => ({ ...patch(id, label, description, ops, 'Design §7.1'), applicability });
const repairs = [
  rep('C1', 'C1 — Restore precommit beneficiary verification', 'Restore independent W03 and the unavoidable W04 precommit requirement.', [
    { op: 'ensureContract', contract: W03_ENSURE },
    { op: 'addControl', id: 'W04', controlId: 'C1' },
  ]),
  rep('C2', 'C2 — Conditional verification at the payment gateway', 'Reinstate conditional independent verification through W09 and enforce exact beneficiary evidence on every W11/W14 gateway entry.', [
    { op: 'ensureContract', contract: W09_C2 },
    { op: 'addControl', id: 'W11', controlId: 'C2' },
    { op: 'addControl', id: 'W14', controlId: 'C2' },
  ]),
  rep('C3', 'C3 — Bind and revalidate payment authorization', 'Install payload/version/fingerprint binding on all gateway entry points and the bounded re-preparation path.', [
    { op: 'addControl', id: 'W11', controlId: 'C3' },
    { op: 'addControl', id: 'W14', controlId: 'C3' },
  ]),
  rep('C4', 'C4 — Project restricted fields before external extraction', 'Transfer only approved invoice fields; bank/tax processing stays internal.', [{ op: 'addControl', id: 'W06', controlId: 'C4' }], { requiresExternalTransferOtherThan: ['SYS-GATEWAY'] }),
  rep('C5', 'C5 — Restore human supplier-maintenance execution', 'Revoke the agent direct master-write capability; restore human W02/W04 and the verified commit path.', [
    { op: 'setActor', id: 'W02', actorId: 'P-MAINT' },
    { op: 'setActor', id: 'W04', actorId: 'P-MAINT' },
    { op: 'removeCapability', grantId: 'G-SVCSUP-MASTER-WRITE' },
    { op: 'ensureContract', contract: W03_ENSURE },
    { op: 'addControl', id: 'W04', controlId: 'C1' },
  ]),
  rep('C6', 'C6 — Enforce settlement idempotency', 'Use the payment-obligation key at the gateway for both initial and retry submissions.', [
    { op: 'addControl', id: 'W11', controlId: 'C6' },
    { op: 'addControl', id: 'W14', controlId: 'C6' },
  ]),
];

// ---------- variants ----------
const variant = (id, label, description, ops) => patch(id, label, description, ops, 'Design §10 mutation');
const variants = [
  variant('V-NO-C3', 'Mutant: payload binding removed', 'Remove the C3 gateway binding on W11/W14.', [
    { op: 'removeControl', id: 'W11', controlId: 'C3' },
    { op: 'removeControl', id: 'W14', controlId: 'C3' },
  ]),
  variant('V-NO-C6', 'Mutant: settlement idempotency removed', 'Remove the C6 obligation-key idempotency on W11/W14.', [
    { op: 'removeControl', id: 'W11', controlId: 'C6' },
    { op: 'removeControl', id: 'W14', controlId: 'C6' },
  ]),
  variant('V-EXTERNAL-EXTRACTOR', 'Experiment: external extraction service', 'Move the extraction service outside the administrative boundary; it accepts no restricted categories.', [
    { op: 'setSystem', id: 'SYS-EXTRACTOR', boundary: 'external', acceptedCategories: [], approvedPurposes: ['invoice-extraction'] },
  ]),
  variant('V-APPROVER-ALIAS', 'Mutant: approval alias shares the preparer credential', 'Different principal and role, same effective credential as the preparer.', [
    { op: 'setPrincipal', id: 'P-APPROVER', effectiveIdentityId: 'ID-P-PAYOPS' },
  ]),
  variant('V-SHARED-GROUP', 'Mutant: approver shares the preparer independence group', 'Different credential, same policy-scoped independence group.', [
    { op: 'setPrincipal', id: 'P-APPROVER', independenceGroup: 'G-PAYOPS' },
  ]),
  variant('V-NORMATIVE-DENY-PAYMENT-AGENT', 'Mutant: normative deny for the payment agent', 'Technical grant stays; company policy denies the payment agent gateway execution.', [
    { op: 'addAuthRule', rule: rule('R-DENY-SVCPAY-EXECUTE', 'deny', ['SVC-PAYMENT'], [], ['execute'], ['gateway:payment'], ['payment-execution']) },
  ]),
  variant('V-NO-PAYMENT-CAPABILITY', 'Mutant: payment submission capability lost', 'Remove the exact gateway submit grant of the human submitter.', [{ op: 'removeCapability', grantId: 'G-PAYOPS-SUBMIT' }]),
  variant('V-HOLD-ALL', 'Mutant: hold every invoice', 'Invoice matching always holds.', [
    { op: 'setBranches', id: 'W07', branches: [br('mismatch', [matchAsset('mismatch'), action('match', 'orderReceiptMatch', [], 'invoice-processing'), ...hold('invoice_mismatch')], { nominal: false })] },
  ]),
  variant('V-UNSAFE-BASELINE', 'Mutant: baseline without W03 and W09', 'Both beneficiary-verification mechanisms are absent in the baseline itself.', [
    { op: 'removeContract', id: 'W03' },
    { op: 'removeControl', id: 'W04', controlId: 'C1' },
    { op: 'removeContract', id: 'W09' },
    { op: 'setPrecondition', id: 'W10', expr: W10_A3.workflowPreconditions },
  ]),
  variant('V-UNKNOWN-CAPABILITIES', 'Mutant: capability inventory unknown', 'The capability inventory is no longer declared complete.', [{ op: 'setCompleteness', key: 'capabilityInventory', value: 'unknown' }]),
  variant('V-UNKNOWN-CONTROL', 'Mutant: control implementation unknown', 'The implementation status of C3 is unknown.', [{ op: 'setControlImplementation', id: 'C3', implemented: 'unknown' }]),
  variant('V-NO-CLEARANCE-GATE', 'Mutant: onboarding clearance not enforced', 'W05 never holds and W08 no longer requires clearance.', [
    { op: 'setBranches', id: 'W05', branches: [br('skip', [action('read', 'supplierMaster', [], 'onboarding-review')])] },
    { op: 'setPrecondition', id: 'W08', expr: all(doneGE('W06'), doneGE('W07'), doneZero('W08'), exists('supplierMaster', CUR), eq(field('orderReceiptMatch', 'result'), lit('match'))) },
  ]),
  variant('V-NO-MATCH-GATE', 'Mutant: invoice match not enforced', 'W07 mismatch no longer holds and W08 no longer requires a match.', [
    { op: 'setBranches', id: 'W07', branches: [br('match', [matchAsset('match'), action('match', 'orderReceiptMatch', [], 'invoice-processing')], { when: amountMatches }), br('mismatch', [matchAsset('mismatch'), action('match', 'orderReceiptMatch', [], 'invoice-processing')], { when: not(amountMatches), nominal: false })] },
    { op: 'setPrecondition', id: 'W08', expr: all(doneGE('W06'), doneGE('W07'), doneZero('W08'), exists('supplierMaster', CUR), ev('hasClearance', 'supplier')) },
  ]),
  variant('V-NO-LIMIT-GATE', 'Mutant: amount limit not enforced', 'W10 issues a routine authorization for any amount.', [
    { op: 'setBranches', id: 'W10', branches: [br('approve_routine', [action('authorize', 'paymentRequest', [], 'payment-authorization'), authEffect(false)])] },
  ]),
  variant('V-COSMETIC-LABELS', 'Cosmetic: display labels changed', 'Only display names change.', [
    { op: 'setLabel', id: 'W03', name: 'Verify payee (renamed)' },
    { op: 'setLabel', id: 'P-VERIFIER', name: 'Renamed verifier' },
  ]),
];

// ---------- cases ----------
const D = (o) => o;
const baseEnv = {
  supplierId: 'SUP-1', supplierChange: false, hasInvoice: true, claimDigest: 'D1', claimTaxId: 'TAX-FICT-001', claimName: 'Fictional Supplies Ltd',
  directoryDigest: 'D0', verificationMethod: 'callback-trusted-directory', verificationSource: 'SYS-DIRECTORY', clearanceOk: true,
  invoiceId: 'INV-1', paymentId: 'PAY-1', obligationId: 'OBL-INV-1', orderAmountCents: 420000, escalationApproved: false,
};
const invoiceAsset = (amountCents) => ({
  kind: 'invoice', objectId: 'INV-1', version: 1, status: 'received',
  fields: [
    { name: 'invoiceId', value: 'INV-1', lineage: ['invoice-document'], categories: [], purposes: ['invoice-extraction', 'payment-execution', 'matching'] },
    { name: 'supplierRef', value: 'SUP-1', lineage: ['invoice-document'], categories: [], purposes: ['invoice-extraction', 'payment-execution', 'matching'] },
    { name: 'amountCents', value: amountCents, lineage: ['invoice-document'], categories: [], purposes: ['invoice-extraction', 'payment-execution', 'matching'] },
    { name: 'currency', value: 'USD', lineage: ['invoice-document'], categories: [], purposes: ['invoice-extraction', 'payment-execution', 'matching'] },
    { name: 'lineItems', value: 'LI-1:widgets', lineage: ['invoice-document'], categories: [], purposes: ['invoice-extraction', 'payment-execution', 'matching'] },
    { name: 'orderRef', value: 'PO-1', lineage: ['invoice-document'], categories: [], purposes: ['invoice-extraction', 'matching'] },
    { name: 'remitBankAccount', value: 'D-REMIT', lineage: ['invoice-document'], categories: ['bank'], purposes: ['payment-execution', 'supplier-maintenance'] },
    { name: 'remitTaxId', value: 'TAX-FICT-001', lineage: ['invoice-document'], categories: ['tax'], purposes: ['supplier-maintenance'] },
    { name: 'extractedAmountCents', value: null, lineage: ['invoice-document'], categories: [], purposes: ['payment-execution', 'matching'] },
    { name: 'summaryText', value: null, lineage: ['invoice-document'], categories: [], purposes: ['invoice-extraction', 'payment-execution', 'matching'] },
  ],
});
const masterV0 = () => ({
  kind: 'supplierMaster', objectId: 'SUP-1', version: 0, status: 'committed',
  fields: [
    { name: 'supplierId', value: 'SUP-1', lineage: ['master-record'], categories: [], purposes: poolPurposes },
    { name: 'accountDigest', value: 'D0', lineage: ['master-record'], categories: ['bank'], purposes: poolPurposes },
    { name: 'taxId', value: 'TAX-FICT-001', lineage: ['master-record'], categories: ['tax'], purposes: ['supplier-maintenance'] },
    { name: 'editor', value: 'P-MAINT', lineage: ['editor'], categories: [], purposes: poolPurposes },
  ],
});
const evBenef = (caseId, o = {}) => ({
  id: 'EV-INIT-BEN-V0', kind: 'beneficiaryVerification', issuer: 'P-VERIFIER',
  subject: { supplierId: 'SUP-1', bankVersion: 0, accountDigest: 'D0' },
  method: 'callback-trusted-directory', sources: ['SYS-DIRECTORY'], validFrom: '2026-01-15', validUntil: '2027-01-15', caseScope: caseId,
  admission: { basis: 'Fixture: admitted prior verification record for the existing master version' }, ...o,
});
const evClear = (caseId) => ({
  id: 'EV-INIT-CLR', kind: 'onboardingClearance', issuer: 'P-CLEARER', subject: { supplierId: 'SUP-1' }, method: 'onboarding-review', sources: ['SYS-MASTER'],
  validFrom: '2026-01-15', validUntil: '2027-01-15', caseScope: caseId, admission: { basis: 'Fixture: admitted prior onboarding clearance' },
});
const existingSupplier = (id, evOverrides) => ({
  initialFacts: { [CUR]: 0, 'bank.next': 1 },
  initialAssets: [masterV0(), invoiceAsset(420000)],
  initialEvidence: [evBenef(id, evOverrides), evClear(id)],
});
const newSupplier = (amount = 420000) => ({ initialFacts: {}, initialAssets: [invoiceAsset(amount)], initialEvidence: [] });
const caseRec = (id, label, sourceRef, o) => ({
  ...meta(id, sourceRef), label, legitimate: o.legitimate ?? true, requiredOutcome: o.required ?? { kind: 'reconciled' },
  env: { ...baseEnv, ...(o.env ?? {}) }, initialFacts: o.initialFacts ?? {}, initialAssets: o.initialAssets, initialEvidence: o.initialEvidence ?? [],
  branchDomains: { W11: ['ack_ok'], W14: ['ack_ok'], W06: ['extract_correct'], ...(o.domains ?? {}) },
  requiresAutomations: o.requires ?? [], suiteIds: o.suites ?? [], ...(o.econ ? { economicClass: o.econ } : {}), economicOnly: o.econOnly ?? false,
});
const newEnv = { supplierChange: true, claimDigest: 'D1', directoryDigest: 'D1' };
const cases = [
  caseRec('CASE-ROUTINE', 'Routine invoice, existing verified supplier', 'Design §10 baseline routine', { ...existingSupplier('CASE-ROUTINE'), suites: ['flagship'], econ: 'routineInvoice' }),
  caseRec('CASE-NEW-VALID', 'New supplier with legitimate bank details, then payment', 'Design §2.2 legitimate change', { ...newSupplier(), env: newEnv, suites: ['flagship'], econ: 'supplierEventPaid' }),
  caseRec('CASE-CHANGE-INVALID', 'Supplier change with unverifiable (forged) bank details', 'Design §2.2 invalid change', { ...newSupplier(), env: { supplierChange: true, claimDigest: 'D9', directoryDigest: 'D1' }, legitimate: false, required: { kind: 'held', reason: 'beneficiary_verification_failed' }, suites: ['flagship'] }),
  caseRec('CASE-SUPPLIER-ONLY', 'Supplier event without payment (economic route only)', 'Design §7.6 supplier events without payment', {
    ...newSupplier(), env: { ...newEnv, hasInvoice: false }, initialAssets: [], required: { kind: 'supplier_committed' }, econ: 'supplierEventUnpaid', econOnly: true,
  }),
  caseRec('CASE-STALE-UPDATE', 'Bounded bank-version update around preparation/approval', 'Design §2.1 stale-approval fixture', {
    ...existingSupplier('CASE-STALE-UPDATE'), env: { supplierChange: true, claimDigest: 'D1', directoryDigest: 'D1' }, suites: ['stale-approval'],
  }),
  caseRec('CASE-EXT-RAW', 'Raw invoice document with bank/tax fields sent to the extractor', 'Design §10 raw restricted fields', { ...existingSupplier('CASE-EXT-RAW'), requires: ['A1'], domains: { W06: ['extract_correct'] }, suites: ['external-transfer'] }),
  caseRec('CASE-EXT-SUMMARY', 'Summary derived from restricted fields sent to the extractor', 'Design §10 summary is not declassification', { ...existingSupplier('CASE-EXT-SUMMARY'), requires: ['A1'], domains: { W06: ['extract_correct_via_summary'] }, suites: ['external-transfer'] }),
  caseRec('CASE-RETRY-UNCERTAIN', 'Settled payment with uncertain acknowledgement, one retry', 'Design §10 retry without idempotency', { ...existingSupplier('CASE-RETRY-UNCERTAIN'), domains: { W11: ['ack_ok', 'ack_uncertain'], W14: ['ack_ok'] }, suites: ['uncertain-retry'] }),
  caseRec('CASE-UNCLEARED', 'New supplier not cleared for onboarding', 'Design §4.2 P05', { ...newSupplier(), env: { ...newEnv, clearanceOk: false }, legitimate: false, required: { kind: 'held', reason: 'onboarding_not_cleared' }, suites: ['assurance-boundaries'] }),
  caseRec('CASE-INVOICE-MISMATCH', 'Invoice does not match order/receipt', 'Design §4.2 P05', { ...existingSupplier('CASE-INVOICE-MISMATCH'), env: { orderAmountCents: 400000 }, legitimate: false, required: { kind: 'held', reason: 'invoice_mismatch' }, suites: ['assurance-boundaries'] }),
  caseRec('CASE-EXTRACTION-MISMATCH', 'Extractor produces a mismatched claim (declared exception case)', 'Plan §3 extraction-mismatch', { ...existingSupplier('CASE-EXTRACTION-MISMATCH'), legitimate: false, required: { kind: 'held', reason: 'invoice_mismatch' }, requires: ['A1'], domains: { W06: ['extract_mismatch'] }, suites: ['assurance-boundaries'] }),
  caseRec('CASE-LIMIT-EXACT', 'Invoice of exactly USD 10,000.00 (routine)', 'Design §4.2 limit boundary', {
    initialFacts: { [CUR]: 0, 'bank.next': 1 }, initialAssets: [masterV0(), invoiceAsset(1000000)], initialEvidence: [evBenef('CASE-LIMIT-EXACT'), evClear('CASE-LIMIT-EXACT')], env: { orderAmountCents: 1000000 }, suites: ['assurance-boundaries'],
  }),
  caseRec('CASE-LIMIT-OVER', 'Invoice of USD 10,000.01 without escalation', 'Design §4.2 limit boundary', {
    initialFacts: { [CUR]: 0, 'bank.next': 1 }, initialAssets: [masterV0(), invoiceAsset(1000001)], initialEvidence: [evBenef('CASE-LIMIT-OVER'), evClear('CASE-LIMIT-OVER')], env: { orderAmountCents: 1000001 }, legitimate: false, required: { kind: 'held', reason: 'escalation_required' }, suites: ['assurance-boundaries'],
  }),
  caseRec('CASE-LIMIT-OVER-ESCALATED', 'Invoice of USD 10,000.01 with admitted escalation', 'Design §4.2 limit boundary', {
    initialFacts: { [CUR]: 0, 'bank.next': 1 }, initialAssets: [masterV0(), invoiceAsset(1000001)], initialEvidence: [evBenef('CASE-LIMIT-OVER-ESCALATED'), evClear('CASE-LIMIT-OVER-ESCALATED')], env: { orderAmountCents: 1000001, escalationApproved: true }, suites: ['assurance-boundaries'],
  }),
  caseRec('CASE-EXPIRED-EVIDENCE', 'Existing supplier whose verification evidence expired', 'Design §10 expired evidence', { ...existingSupplier('CASE-EXPIRED-EVIDENCE', { validUntil: '2026-09-30' }), suites: ['assurance-boundaries'] }),
  caseRec('CASE-WRONG-DIGEST-EVIDENCE', 'Existing supplier whose evidence covers a different account digest', 'Design §10 wrong digest', { ...existingSupplier('CASE-WRONG-DIGEST-EVIDENCE', { subject: { supplierId: 'SUP-1', bankVersion: 0, accountDigest: 'D8' } }), suites: ['assurance-boundaries'] }),
  caseRec('CASE-WRONG-VERSION-EVIDENCE', 'Existing supplier whose evidence covers an old bank version', 'Design §10 old evidence for new version', { ...existingSupplier('CASE-WRONG-VERSION-EVIDENCE', { subject: { supplierId: 'SUP-1', bankVersion: 7, accountDigest: 'D0' } }), suites: ['assurance-boundaries'] }),
  caseRec('CASE-WRONG-CASE-EVIDENCE', 'Existing supplier whose evidence belongs to another case', 'Design §10 cross-case evidence', { ...existingSupplier('CASE-WRONG-CASE-EVIDENCE', { caseScope: 'CASE-OTHER' }), suites: ['assurance-boundaries'] }),
  caseRec('CASE-WRONG-SUPPLIER-EVIDENCE', 'Existing supplier whose evidence covers another supplier', 'Design §10 wrong supplier', { ...existingSupplier('CASE-WRONG-SUPPLIER-EVIDENCE', { subject: { supplierId: 'SUP-2', bankVersion: 0, accountDigest: 'D0' } }), suites: ['assurance-boundaries'] }),
  caseRec('CASE-UNTRUSTED-EVIDENCE', 'Existing supplier whose evidence came from a supplier-supplied callback number', 'Design §4.3 untrusted source', { ...existingSupplier('CASE-UNTRUSTED-EVIDENCE', { method: 'callback-supplied-number', sources: ['SUPPLIER-REQUEST-PHONE'] }), suites: ['assurance-boundaries'] }),
];

const suites = [
  { ...meta('flagship', 'Design §10'), label: 'Flagship', description: 'Routine invoice, legitimate new supplier, and invalid bank-detail change.', caseIds: ['CASE-ROUTINE', 'CASE-NEW-VALID', 'CASE-CHANGE-INVALID'] },
  { ...meta('stale-approval', 'Design §2.1'), label: 'Stale approval', description: 'One bounded supplier bank-version update interleaved with payment preparation, approval and submission.', caseIds: ['CASE-STALE-UPDATE'] },
  { ...meta('external-transfer', 'Design §10'), label: 'External transfer', description: 'Extraction with raw restricted fields and with a restricted-derived summary (requires A1).', caseIds: ['CASE-EXT-RAW', 'CASE-EXT-SUMMARY'] },
  { ...meta('uncertain-retry', 'Design §10'), label: 'Uncertain retry', description: 'Settled-but-acknowledgement-uncertain payment and one retry.', caseIds: ['CASE-RETRY-UNCERTAIN'] },
  {
    ...meta('assurance-boundaries', 'Design §10'), label: 'Assurance boundaries',
    description: 'Clearance, match, extraction-mismatch, limit boundaries, and defective initial evidence.',
    caseIds: cases.filter((c) => c.suiteIds.includes('assurance-boundaries')).map((c) => c.id),
  },
];

// ---------- economics & assumptions ----------
const economics = {
  ...meta('ECON', 'Design §7.6', 'assumed'),
  monthly: { invoices: 1000, supplierEvents: 100, paidSupplierEvents: 60 },
  humanHourValueUsd: 60,
  reviewCapacityHours: 16,
  amortizationMonths: 12,
  platform: { recurringUsd: 700, setupUsd: 3600 },
  controlCosts: { C1: { recurringUsd: 40, setupUsd: 0 }, C2: { recurringUsd: 80, setupUsd: 0 }, C3: { recurringUsd: 0, setupUsd: 0 }, C4: { recurringUsd: 0, setupUsd: 0 }, C5: { recurringUsd: 0, setupUsd: 0 }, C6: { recurringUsd: 0, setupUsd: 0 } },
  classes: [
    { id: 'routineInvoice', label: 'Routine invoices (existing verified supplier)', caseId: 'CASE-ROUTINE', routeActivities: ['W06', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12'] },
    { id: 'supplierEventPaid', label: 'Supplier events leading to payment', caseId: 'CASE-NEW-VALID', routeActivities: ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12'] },
    { id: 'supplierEventUnpaid', label: 'Supplier events without payment', caseId: 'CASE-SUPPLIER-ONLY', routeActivities: ['W01', 'W02', 'W03', 'W04', 'W05'] },
  ],
};
const asm = (id, category, text, status = 'assumed') => ({ ...meta(id, 'Plan assumptions', status), category, text });
const assumptions = [
  asm('AS-SCOPE', 'scope', 'Fictional finite-model demonstration: Northstar, its principals, identifiers, digests and policies are stipulated, not real data and not legal obligations.', 'fixture'),
  asm('AS-LIMIT', 'modeling', 'The USD 10,000.00 routine payment limit is a fixture parameter; currency is USD only and amounts are integer cents.', 'fixture'),
  asm('AS-MATCHER', 'modeling', 'The deterministic matcher is operated through the invoice clerk principal; no extra service principal is modeled for it.', 'assumed'),
  asm('AS-ECON-PLATFORM', 'economic', 'Platform cost is platform-wide: USD 700/month plus USD 3,600 setup amortized over 12 months whenever any automation is requested; no per-automation allocation is invented.'),
  asm('AS-ECON-CONTROLS', 'economic', 'Incremental recurring cost: C1 USD 40, C2 USD 80, C5 none; C3/C4/C6 zero in these synthetic fixtures; additional repair setup defaults to zero.'),
  asm('AS-ECON-MINUTES', 'economic', 'Human minutes are stipulated per activity branch (W02 1, W03 6, W04 1, W06 5, W08 3, W11 1, verification 6); unvaried activities are charged zero. Savings are disjoint stipulated reductions, not measurements.'),
  asm('AS-ECON-CAPACITY', 'economic', 'Capacity-equivalent value is not guaranteed cash savings; the 16-hour review budget is an editable synthetic default (the supplied eight-hour scenario is reproducible by editing it).'),
  asm('AS-ROUTE', 'economic', 'Economic classes use one declared nominal valid route each (correct extraction, successful acknowledgement, no adversarial ordering); path counts are not business frequencies.'),
  asm('AS-RISK', 'assurance', 'Reachability is a possibility statement, not a probability; no risk score is produced.', 'fixture'),
];

const northstar = {
  schemaVersion: '1.0.0', graphVersion: '0.1.0', policyVersion: '0.1.0', analysisDate: '2026-10-06',
  completeness: { capabilityInventory: 'complete', controlImplementation: 'complete', evidenceInventory: 'complete' },
  entities, contracts, capabilities, authorization, policies, automations, repairs, variants,
};
fs.mkdirSync('src/fixtures', { recursive: true });
fs.writeFileSync('src/fixtures/northstar.json', JSON.stringify(northstar, null, 2) + '\n');
fs.writeFileSync('src/fixtures/cases.json', JSON.stringify({ suites, cases }, null, 2) + '\n');
fs.writeFileSync('src/fixtures/assumptions.json', JSON.stringify({ economics, assumptions }, null, 2) + '\n');
console.log('entities', entities.length, 'contracts', contracts.length, 'cases', cases.length);
