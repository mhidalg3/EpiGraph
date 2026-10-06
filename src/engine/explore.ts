import type {
  AnalysisLimits,
  CaseRecord,
  CaseReport,
  ExecutionState,
  GoalFailure,
  ModelEvent,
  PolicyId,
  SemanticAtom,
  TupleRef,
  Witness,
} from '../model/types';
import { shortHash, stateKey } from './canonicalize';
import type { CompiledModel } from './compile';
import { atomsOf } from './differential';
import { checkInitial, checkTransition, hazardId, type Violation } from './policies';
import { applyTransition, enabledTransitions, initialState, type Transition } from './transitions';

export interface StepRecord {
  transition: Transition;
  events: ModelEvent[];
  consumed: TupleRef[];
  produced: TupleRef[];
  summary: string;
  keyAfter: string;
}

export interface RawFinding {
  hazardId: string;
  policyId: PolicyId;
  caseId: string;
  mechanism: string;
  violation: Violation;
  witness: Witness;
}

export interface CaseExploration {
  report: CaseReport;
  findings: RawFinding[];
  goalFailures: GoalFailure[];
  atoms: Map<string, SemanticAtom>;
  complete: boolean;
  shortCircuited: boolean;
}

export interface ExploreOptions {
  shortCircuit?: boolean;
}

export function bundleFingerprint(model: CompiledModel): string {
  return shortHash(model.semanticKey);
}

export function toWitness(
  model: CompiledModel,
  c: CaseRecord,
  initialKey: string,
  steps: StepRecord[],
  hazard: string,
  policyId: PolicyId | 'GOAL',
  v: { mechanism: string; message: string; reasons: string[]; eventIndex: number },
): Witness {
  return {
    id: `W|${hazard}`,
    hazardId: hazard,
    policyId,
    caseId: c.id,
    bundleFingerprint: bundleFingerprint(model),
    initialStateKeyHash: shortHash(initialKey),
    steps: steps.map((s, i) => ({
      index: i,
      transitionId: s.transition.id,
      activityId: s.transition.activityId,
      branchId: s.transition.branchId,
      actorId: s.transition.actorId,
      summary: s.summary,
      consumed: s.consumed,
      produced: s.produced,
      events: s.events,
      stateKeyHashAfter: shortHash(s.keyAfter),
    })),
    violation: {
      policyId,
      stepIndex: Math.max(0, steps.length - 1),
      eventIndex: v.eventIndex,
      message: v.message,
      reasons: v.reasons,
    },
  };
}

interface Node {
  state: ExecutionState;
  key: string;
  parent: number;
  via: StepRecord | null;
}

function pathTo(nodes: Node[], idx: number): StepRecord[] {
  const steps: StepRecord[] = [];
  for (let i = idx; i > 0; i = nodes[i]!.parent) steps.push(nodes[i]!.via!);
  return steps.reverse();
}

function describeTerminal(state: ExecutionState): string {
  const d = state.facts.disposition;
  if (d === 'held') return `held:${String(state.facts['hold.reason'])}`;
  if (d === 'reconciled') return 'reconciled';
  return 'nonterminal';
}

export interface GoalFinding {
  kind: GoalFailure['kind'];
  actual: string;
  message: string;
}

export const goalFailureId = (caseId: string, f: GoalFinding) => `GOAL|${f.kind}|${caseId}|${f.actual}`;

/** More than one settlement for the obligation fails the business goals in any state. */
export function settlementFailure(state: ExecutionState): GoalFinding | null {
  const settle = state.facts['settle.count'];
  return typeof settle === 'number' && settle > 1 ? { kind: 'second_settlement', actual: `settled:${settle}`, message: `Obligation settled ${settle} times` } : null;
}

/** Terminal classification for a state without enabled transitions: shared by exploration and witness replay. */
export function classifyTerminal(c: CaseRecord, state: ExecutionState): { label: string; failure: GoalFinding | null } {
  const req = c.requiredOutcome;
  if (state.facts.disposition === '') {
    const committed =
      req.kind === 'supplier_committed' &&
      typeof state.facts['master.current'] === 'number' &&
      (state.facts['master.current'] as number) >= 0 &&
      state.evidence.some((e) => e.kind === 'onboardingClearance');
    if (committed) return { label: 'supplier_committed', failure: null };
    return { label: 'deadlock', failure: { kind: 'deadlock', actual: 'nonterminal', message: 'Reachable nonterminal state with no enabled transition' } };
  }
  const actual = describeTerminal(state);
  const ok = (req.kind === 'reconciled' && actual === 'reconciled' && state.facts['settle.count'] === 1) || (req.kind === 'held' && actual === `held:${req.reason}`);
  if (ok) return { label: actual, failure: null };
  const want = req.kind === 'held' ? `held:${req.reason}` : req.kind;
  return {
    label: actual,
    failure: { kind: c.legitimate && actual.startsWith('held') ? 'legitimate_hold' : 'wrong_terminal', actual, message: `Case ends '${actual}' but the required outcome is '${want}'` },
  };
}

export function exploreCase(model: CompiledModel, c: CaseRecord, limits: AnalysisLimits, opts: ExploreOptions = {}): CaseExploration {
  const findings = new Map<string, RawFinding>();
  const goalFailures = new Map<string, GoalFailure>();
  const atoms = new Map<string, SemanticAtom>();
  const terminals: Record<string, number> = {};
  const reasons: string[] = [];
  let transitionsCount = 0;
  let deadlocks = 0;
  let partial = false;
  let shortCircuited = false;

  const init = initialState(model, c);
  const initKey = stateKey(init);
  const nodes: Node[] = [{ state: init, key: initKey, parent: -1, via: null }];
  const visited = new Set<string>([initKey]);

  const record = (v: Violation, steps: StepRecord[]) => {
    const id = hazardId(v.policyId, v.mechanism, c.id);
    if (findings.has(id)) return;
    findings.set(id, {
      hazardId: id,
      policyId: v.policyId,
      caseId: c.id,
      mechanism: v.mechanism,
      violation: v,
      witness: toWitness(model, c, initKey, steps, id, v.policyId, v),
    });
    if (opts.shortCircuit) shortCircuited = true;
  };
  const failGoal = (kind: GoalFailure['kind'], actual: string, message: string, steps: StepRecord[]) => {
    const id = `GOAL|${kind}|${c.id}|${actual}`;
    if (goalFailures.has(id)) return;
    goalFailures.set(id, {
      id,
      caseId: c.id,
      kind,
      message,
      required: c.requiredOutcome,
      actual,
      witness: toWitness(model, c, initKey, steps, id, 'GOAL', { mechanism: kind, message, reasons: [message], eventIndex: -1 }),
    });
    if (opts.shortCircuit) shortCircuited = true;
  };

  for (const v of checkInitial(model, c, init)) record(v, []);

  for (let head = 0; head < nodes.length; head++) {
    if (shortCircuited) break;
    const node = nodes[head]!;
    const ts = enabledTransitions(model, c, node.state);

    const multi = settlementFailure(node.state);
    if (multi) failGoal(multi.kind, multi.actual, multi.message, pathTo(nodes, head));

    if (ts.length === 0) {
      const t = classifyTerminal(c, node.state);
      terminals[t.label] = (terminals[t.label] ?? 0) + 1;
      if (t.label === 'deadlock') deadlocks++;
      if (t.failure) failGoal(t.failure.kind, t.failure.actual, t.failure.message, pathTo(nodes, head));
      continue;
    }

    for (const t of ts) {
      transitionsCount++;
      if (transitionsCount > limits.maxTransitionsPerCase) {
        partial = true;
        reasons.push(`maxTransitionsPerCase (${limits.maxTransitionsPerCase}) reached`);
        break;
      }
      const applied = applyTransition(model, c, node.state, t);
      const key = stateKey(applied.state);
      const step: StepRecord = { transition: t, events: applied.events, consumed: applied.consumed, produced: applied.produced, summary: applied.summary, keyAfter: key };

      const viols = checkTransition({ model, c, pre: node.state, post: applied.state, transition: t, events: applied.events });
      if (viols.length > 0) {
        const steps = [...pathTo(nodes, head), step];
        for (const v of viols) record(v, steps);
      }
      for (const a of atomsOf(model, c, node.state, applied.events)) if (!atoms.has(a.signature)) atoms.set(a.signature, a);

      if (!visited.has(key)) {
        if (visited.size >= limits.maxStatesPerCase) {
          if (!partial) reasons.push(`maxStatesPerCase (${limits.maxStatesPerCase}) reached`);
          partial = true;
        } else {
          visited.add(key);
          nodes.push({ state: applied.state, key, parent: head, via: step });
        }
      }
      if (shortCircuited) break;
    }
    if (partial && transitionsCount > limits.maxTransitionsPerCase) break;
  }

  if (shortCircuited) {
    partial = true;
    reasons.push('exploration short-circuited after a confirmed counterexample');
  }
  const report: CaseReport = {
    caseId: c.id,
    label: c.label,
    status: partial ? 'partial' : 'complete',
    statesExplored: visited.size,
    transitionsExplored: transitionsCount,
    terminalDispositions: Object.fromEntries(Object.entries(terminals).sort()),
    deadlocks,
    reasons: [...new Set(reasons)],
  };
  return {
    report,
    findings: [...findings.values()],
    goalFailures: [...goalFailures.values()],
    atoms,
    complete: !partial,
    shortCircuited,
  };
}
