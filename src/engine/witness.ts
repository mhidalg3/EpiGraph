import type { ModelEvent, Witness, WitnessReplayResult } from '../model/types';
import { canonicalJson, shortHash, stateKey } from './canonicalize';
import type { CompiledModel } from './compile';
import { bundleFingerprint, classifyTerminal, goalFailureId, settlementFailure } from './explore';
import { checkInitial, checkTransition, hazardId } from './policies';
import { applyTransition, enabledTransitions, initialState, type Transition } from './transitions';

const reject = (reasons: string[], verifiedSteps: number, failingStepIndex: number | null): WitnessReplayResult => ({
  status: 'rejected',
  reasons,
  verifiedSteps,
  failingStepIndex,
  violation: null,
});

/**
 * Replays a witness from its declared initial state by regenerating the enabled transitions at every step.
 * Unknown, tampered, disabled, wrong-model or wrong-design steps are rejected, and the alleged violation is re-confirmed.
 */
export function replayOnModel(model: CompiledModel, w: Witness): WitnessReplayResult {
  if (w.bundleFingerprint !== bundleFingerprint(model))
    return reject(['Witness was produced for a different model or design (bundle fingerprint mismatch)'], 0, null);
  const c = model.bundle.cases.find((x) => x.id === w.caseId);
  if (!c) return reject([`Unknown case ${w.caseId}`], 0, null);
  let state = initialState(model, c);
  if (shortHash(stateKey(state)) !== w.initialStateKeyHash) return reject(['Declared initial state does not match the case fixture'], 0, null);

  let prev = state;
  let lastEvents: ModelEvent[] = [];
  let lastTransition: Transition | null = null;
  for (const step of w.steps) {
    const t = enabledTransitions(model, c, state).find((x) => x.id === step.transitionId);
    if (!t) return reject([`Step ${step.index}: transition ${step.transitionId} is not enabled in the regenerated model`], step.index, step.index);
    const applied = applyTransition(model, c, state, t);
    if (step.actorId !== t.actorId || step.branchId !== t.branchId || step.activityId !== t.activityId || step.summary !== applied.summary)
      return reject([`Step ${step.index}: actor/branch/summary differ from the regenerated step`], step.index, step.index);
    if (canonicalJson(applied.events) !== canonicalJson(step.events))
      return reject([`Step ${step.index}: recorded events differ from the regenerated events (tampered tuple or payload)`], step.index, step.index);
    if (canonicalJson(applied.consumed) !== canonicalJson(step.consumed) || canonicalJson(applied.produced) !== canonicalJson(step.produced))
      return reject([`Step ${step.index}: consumed/produced tuples differ from the regenerated step`], step.index, step.index);
    if (shortHash(stateKey(applied.state)) !== step.stateKeyHashAfter)
      return reject([`Step ${step.index}: resulting state differs from the recorded state`], step.index, step.index);
    prev = state;
    state = applied.state;
    lastEvents = applied.events;
    lastTransition = t;
  }

  if (w.policyId === 'GOAL') {
    const found = settlementFailure(state) ?? (enabledTransitions(model, c, state).length === 0 ? classifyTerminal(c, state).failure : null);
    if (!found || goalFailureId(c.id, found) !== w.hazardId)
      return reject(['The final state does not exhibit the alleged business-goal failure'], w.steps.length, null);
    return {
      status: 'verified',
      reasons: [],
      verifiedSteps: w.steps.length,
      failingStepIndex: null,
      violation: { policyId: 'GOAL', stepIndex: Math.max(0, w.steps.length - 1), eventIndex: -1, message: found.message, reasons: [found.message] },
    };
  }

  const viols = lastTransition
    ? checkTransition({ model, c, pre: prev, post: state, transition: lastTransition, events: lastEvents })
    : checkInitial(model, c, state);
  const hit = viols.find((v) => hazardId(v.policyId, v.mechanism, c.id) === w.hazardId);
  if (!hit) return reject([`The final step does not violate ${w.policyId} (${w.hazardId})`], w.steps.length, w.steps.length - 1);
  return {
    status: 'verified',
    reasons: [],
    verifiedSteps: w.steps.length,
    failingStepIndex: lastTransition ? w.steps.length - 1 : null,
    violation: { policyId: hit.policyId, stepIndex: Math.max(0, w.steps.length - 1), eventIndex: hit.eventIndex, message: hit.message, reasons: hit.reasons },
  };
}
