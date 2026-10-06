import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Witness } from '../model/types';
import type { ReasonerRequest, ReasonerResponse } from '../workers/protocol';
import { useAppState, useDispatch, type AppState, type ReasonerApi } from './state';

type SlotKey = 'analysis' | 'diff' | 'composition' | 'synthesis';
type Target = { target: 'slot'; slot: SlotKey } | { target: 'replay'; witnessId: string };
type Inputs = Pick<AppState, 'bundle' | 'variantIds' | 'caseIds' | 'limits' | 'design' | 'baselineAutomationIds' | 'objective'>;
type InFlight = Target & { inputs: Inputs };

const INPUT_KEYS: (keyof Inputs)[] = ['bundle', 'variantIds', 'caseIds', 'limits', 'design', 'baselineAutomationIds', 'objective'];
/** Reducer edits always produce new references for edited inputs, so reference inequality means the run is stale. */
const inputsChanged = (a: Inputs, b: Inputs): boolean => INPUT_KEYS.some((k) => a[k] !== b[k]);

const ReasonerCtx = createContext<ReasonerApi | null>(null);

/** Owns the single native module worker. Responses whose request is no longer the running one for its slot are dropped. */
export function ReasonerProvider({ children }: { children: ReactNode }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const stateRef = useRef(state);
  stateRef.current = state;
  const workerRef = useRef<Worker | null>(null);
  const inFlight = useRef(new Map<number, InFlight>());
  const nextId = useRef(1);

  const failAll = useCallback(
    (message: string) => {
      for (const [requestId, f] of inFlight.current) {
        if (f.target === 'slot') dispatch({ type: 'runFailed', slot: f.slot, requestId, message });
        else dispatch({ type: 'replayFailed', witnessId: f.witnessId, message });
      }
      inFlight.current.clear();
    },
    [dispatch],
  );

  const stillCurrent = useCallback((requestId: number, f: InFlight): boolean => {
    const s = stateRef.current;
    if (f.target === 'replay') return s.replay?.status === 'running' && s.replay.witnessId === f.witnessId;
    const slot = s[f.slot];
    return slot.status === 'running' && slot.requestId === requestId;
  }, []);

  const handle = useCallback(
    (msg: ReasonerResponse) => {
      const f = inFlight.current.get(msg.requestId);
      if (!f) return;
      if (!stillCurrent(msg.requestId, f)) {
        inFlight.current.delete(msg.requestId);
        return;
      }
      if (msg.type === 'progress') {
        if (f.target === 'slot') dispatch({ type: 'runProgress', slot: f.slot, requestId: msg.requestId, completed: msg.completed, total: msg.total, label: msg.label });
        return;
      }
      inFlight.current.delete(msg.requestId);
      if (msg.type === 'error') {
        if (f.target === 'slot') dispatch({ type: 'runFailed', slot: f.slot, requestId: msg.requestId, message: msg.message });
        else dispatch({ type: 'replayFailed', witnessId: f.witnessId, message: msg.message });
        return;
      }
      const { data, hashes, durationMs, requestId } = msg;
      switch (data.kind) {
        case 'analyze':
          dispatch({ type: 'analysisDone', requestId, value: data.report, hashes, durationMs });
          break;
        case 'compare':
          dispatch({ type: 'diffDone', requestId, value: data.diff, hashes, durationMs });
          break;
        case 'composition':
          dispatch({ type: 'compositionDone', requestId, value: data.composition, hashes, durationMs });
          break;
        case 'synthesize':
          dispatch({ type: 'synthesisDone', requestId, value: data.synthesis, hashes, durationMs });
          break;
        case 'replay':
          if (f.target === 'replay') dispatch({ type: 'replayDone', witnessId: f.witnessId, result: data.replay });
          break;
      }
    },
    [dispatch, stillCurrent],
  );

  const terminate = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const getWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL('../workers/reasoner.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ReasonerResponse>) => {
      if (workerRef.current === worker) handle(e.data);
    };
    const crashed = (message: string) => {
      if (workerRef.current !== worker) return;
      terminate();
      failAll(message);
    };
    worker.onerror = (e) => crashed(`Worker failed: ${e.message || 'unknown error'}`);
    worker.onmessageerror = () => crashed('Worker failed: a response could not be deserialized');
    workerRef.current = worker;
    return worker;
  }, [handle, terminate, failAll]);

  useEffect(() => terminate, [terminate]);

  const post = useCallback(
    (build: (base: { requestId: number; bundle: AppState['bundle']; variantIds: string[]; caseIds: string[]; limits: AppState['limits'] }) => ReasonerRequest, target: Target): void => {
      const s = stateRef.current;
      const requestId = nextId.current++;
      if (target.target === 'replay') for (const [id, f] of inFlight.current) if (f.target === 'replay') inFlight.current.delete(id);
      inFlight.current.set(requestId, { ...target, inputs: s });
      if (target.target === 'slot') {
        const label = target.slot === 'analysis' ? 'Analyzing design' : target.slot === 'diff' ? 'Comparing with baseline' : target.slot === 'composition' ? 'Analyzing automation subsets' : 'Searching repairs';
        const total = target.slot === 'analysis' ? s.caseIds.length : 1;
        dispatch({ type: 'runStarted', slot: target.slot, requestId, total, label });
      } else {
        dispatch({ type: 'replayStarted', witnessId: target.witnessId });
      }
      try {
        getWorker().postMessage(build({ requestId, bundle: s.bundle, variantIds: s.variantIds, caseIds: s.caseIds, limits: s.limits }));
      } catch (e) {
        inFlight.current.delete(requestId);
        const message = `Could not start analysis: ${e instanceof Error ? e.message : String(e)}`;
        if (target.target === 'slot') dispatch({ type: 'runFailed', slot: target.slot, requestId, message });
        else dispatch({ type: 'replayFailed', witnessId: target.witnessId, message });
      }
    },
    [dispatch, getWorker],
  );

  const compare = useCallback(() => {
    const s = stateRef.current;
    post((b) => ({ ...b, kind: 'compare', baseline: { automationIds: s.baselineAutomationIds, controlIds: [] }, candidate: s.design }), { target: 'slot', slot: 'diff' });
  }, [post]);

  const analyze = useCallback(() => {
    const s = stateRef.current;
    post((b) => ({ ...b, kind: 'analyze', design: s.design }), { target: 'slot', slot: 'analysis' });
    const differs = s.baselineAutomationIds.length !== s.design.automationIds.length || s.baselineAutomationIds.some((id, i) => id !== s.design.automationIds[i]);
    if (differs) compare();
  }, [post, compare]);

  const runComposition = useCallback(() => {
    const s = stateRef.current;
    post((b) => ({ ...b, kind: 'composition', candidateIds: s.bundle.automations.map((a) => a.id) }), { target: 'slot', slot: 'composition' });
  }, [post]);

  const runSynthesis = useCallback(() => {
    const s = stateRef.current;
    post((b) => ({ ...b, kind: 'synthesize', design: s.design, objective: s.objective }), { target: 'slot', slot: 'synthesis' });
  }, [post]);

  const replay = useCallback(
    (witness: Witness) => {
      const s = stateRef.current;
      post((b) => ({ ...b, kind: 'replay', design: s.design, witness }), { target: 'replay', witnessId: witness.id });
    },
    [post],
  );

  const cancel = useCallback(() => {
    terminate();
    inFlight.current.clear();
    dispatch({ type: 'cancelAll' });
  }, [terminate, dispatch]);

  // An input edit clears the result slots; the worker would otherwise keep computing a stale run and block the next one.
  useEffect(() => {
    const entries = [...inFlight.current.values()];
    if (!entries.some((f) => inputsChanged(f.inputs, state))) return;
    terminate();
    inFlight.current.clear();
    // every dropped request is dead with the worker: any slot still marked running must become cancelled, never hang
    dispatch({ type: 'cancelAll' });
  }, [state, terminate, dispatch]);

  const busy =
    state.analysis.status === 'running' ||
    state.diff.status === 'running' ||
    state.composition.status === 'running' ||
    state.synthesis.status === 'running' ||
    state.replay?.status === 'running';
  const api = useMemo<ReasonerApi>(() => ({ busy, analyze, compare, runComposition, runSynthesis, replay, cancel }), [busy, analyze, compare, runComposition, runSynthesis, replay, cancel]);
  return createElement(ReasonerCtx.Provider, { value: api }, children);
}

export function useReasoner(): ReasonerApi {
  const api = useContext(ReasonerCtx);
  if (!api) throw new Error('useReasoner outside ReasonerProvider');
  return api;
}
