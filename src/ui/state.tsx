import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import { loadBundledBundle, SUITE_DEFAULT } from '../fixtures';
import { DEFAULT_LIMITS } from '../model/schemas';
import type {
  AnalysisLimits,
  AnalysisReport,
  CompositionReport,
  Design,
  DiffReport,
  EconomicAssumptions,
  ModelBundle,
  SynthesisReport,
  Witness,
  WitnessReplayResult,
} from '../model/types';
import type { ReportHashes } from '../workers/protocol';

export type TabId = 'findings' | 'composition' | 'repairs' | 'assumptions';
export type RunKind = 'analyze' | 'compare' | 'composition' | 'synthesize' | 'replay';

/** One result slot. 'idle' means no run for the current inputs: nothing may be rendered as a verdict. */
export type Slot<T> =
  | { status: 'idle' }
  | { status: 'running'; requestId: number; completed: number; total: number; label: string }
  | { status: 'done'; value: T; hashes: ReportHashes; durationMs: number }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' };

export interface ReplaySlot {
  witnessId: string;
  status: 'running' | 'done' | 'failed';
  result?: WitnessReplayResult;
  message?: string;
}

export type Selection =
  | { type: 'activity'; id: string }
  | { type: 'finding'; id: string }
  | { type: 'step'; findingId: string; index: number }
  | { type: 'control'; id: string }
  | { type: 'principal'; id: string }
  | { type: 'system'; id: string }
  | null;

export interface Overlays {
  dependency: boolean;
  data: boolean;
  authority: boolean;
}

export interface Notice {
  kind: 'info' | 'error';
  text: string;
}

export interface AppState {
  /** Model as loaded/imported (variants are applied by the engine, never here). */
  bundle: ModelBundle;
  bundleSource: 'bundled' | 'imported';
  suiteId: string;
  caseIds: string[];
  variantIds: string[];
  /** Comparison baseline automations (default: manual). */
  baselineAutomationIds: string[];
  /** Candidate design under inspection. */
  design: Design;
  limits: AnalysisLimits;
  objective: 'least_disruption' | 'maximum_value';

  analysis: Slot<AnalysisReport>;
  diff: Slot<DiffReport>;
  composition: Slot<CompositionReport>;
  synthesis: Slot<SynthesisReport>;
  replay: ReplaySlot | null;
  /** Witnesses restored from an imported report (for replay against the restored model). */
  importedWitnesses: Witness[];

  tab: TabId;
  selection: Selection;
  overlays: Overlays;
  /** Automation being hovered/focused in the scenario panel or the impact legend; highlights the activities it touches. View-only. */
  previewAutomationId: string | null;
  notices: Notice[];
}

const idle = { status: 'idle' } as const;

export function initialState(): AppState {
  const bundle = loadBundledBundle();
  const suite = bundle.suites.find((s) => s.id === SUITE_DEFAULT) ?? bundle.suites[0]!;
  return {
    bundle,
    bundleSource: 'bundled',
    suiteId: suite.id,
    caseIds: [...suite.caseIds],
    variantIds: [],
    baselineAutomationIds: [],
    design: { automationIds: [], controlIds: [] },
    limits: { ...DEFAULT_LIMITS },
    objective: 'least_disruption',
    analysis: idle,
    diff: idle,
    composition: idle,
    synthesis: idle,
    replay: null,
    importedWitnesses: [],
    tab: 'findings',
    selection: null,
    overlays: { dependency: true, data: false, authority: false },
    previewAutomationId: null,
    notices: [],
  };
}

export type Action =
  // ----- input edits: every one of these clears ALL results (no stale green) -----
  | { type: 'setSuite'; suiteId: string }
  | { type: 'setVariants'; variantIds: string[] }
  | { type: 'toggleAutomation'; id: string }
  | { type: 'setDesign'; design: Design }
  | { type: 'toggleControl'; id: string }
  | { type: 'setBaseline'; automationIds: string[] }
  | { type: 'setLimits'; limits: AnalysisLimits }
  | { type: 'setObjective'; objective: 'least_disruption' | 'maximum_value' }
  | { type: 'setEconomics'; economics: EconomicAssumptions }
  | { type: 'loadBundle'; bundle: ModelBundle; source: 'bundled' | 'imported'; design?: Design; variantIds?: string[]; caseIds?: string[]; limits?: AnalysisLimits; witnesses?: Witness[]; baselineAutomationIds?: string[]; objective?: 'least_disruption' | 'maximum_value' }
  | { type: 'reset' }
  // ----- run lifecycle (dispatched by useReasoner) -----
  | { type: 'runStarted'; slot: 'analysis' | 'diff' | 'composition' | 'synthesis'; requestId: number; total: number; label: string }
  | { type: 'runProgress'; slot: 'analysis' | 'diff' | 'composition' | 'synthesis'; requestId: number; completed: number; total: number; label: string }
  | { type: 'analysisDone'; requestId: number; value: AnalysisReport; hashes: ReportHashes; durationMs: number }
  | { type: 'diffDone'; requestId: number; value: DiffReport; hashes: ReportHashes; durationMs: number }
  | { type: 'compositionDone'; requestId: number; value: CompositionReport; hashes: ReportHashes; durationMs: number }
  | { type: 'synthesisDone'; requestId: number; value: SynthesisReport; hashes: ReportHashes; durationMs: number }
  | { type: 'runFailed'; slot: 'analysis' | 'diff' | 'composition' | 'synthesis'; requestId: number; message: string }
  | { type: 'cancelAll' }
  | { type: 'replayStarted'; witnessId: string }
  | { type: 'replayDone'; witnessId: string; result: WitnessReplayResult }
  | { type: 'replayFailed'; witnessId: string; message: string }
  // ----- view state -----
  | { type: 'setTab'; tab: TabId }
  | { type: 'select'; selection: Selection }
  | { type: 'setOverlay'; overlay: keyof Overlays; on: boolean }
  | { type: 'previewAutomation'; id: string | null }
  | { type: 'notice'; notice: Notice }
  | { type: 'dismissNotices' };

type SlotKey = 'analysis' | 'diff' | 'composition' | 'synthesis';

/** Drops every result and any in-flight run; used by every semantic input edit. */
function cleared(s: AppState): AppState {
  return { ...s, analysis: idle, diff: idle, composition: idle, synthesis: idle, replay: null, selection: null };
}

function setSlot(s: AppState, slot: SlotKey, requestId: number, next: AppState[SlotKey]): AppState {
  const cur = s[slot];
  // Only the request that is currently running may update a slot (stale ids are ignored).
  if (cur.status !== 'running' || cur.requestId !== requestId) return s;
  return { ...s, [slot]: next } as AppState;
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'setSuite': {
      const suite = s.bundle.suites.find((x) => x.id === a.suiteId);
      if (!suite) return s;
      return { ...cleared(s), suiteId: suite.id, caseIds: [...suite.caseIds] };
    }
    case 'setVariants':
      return { ...cleared(s), variantIds: [...a.variantIds].sort() };
    case 'toggleAutomation': {
      const has = s.design.automationIds.includes(a.id);
      const automationIds = (has ? s.design.automationIds.filter((x) => x !== a.id) : [...s.design.automationIds, a.id]).sort();
      return { ...cleared(s), design: { ...s.design, automationIds } };
    }
    case 'toggleControl': {
      const has = s.design.controlIds.includes(a.id);
      const controlIds = (has ? s.design.controlIds.filter((x) => x !== a.id) : [...s.design.controlIds, a.id]).sort();
      return { ...cleared(s), design: { ...s.design, controlIds } };
    }
    case 'setDesign':
      return { ...cleared(s), design: { automationIds: [...a.design.automationIds].sort(), controlIds: [...a.design.controlIds].sort() } };
    case 'setBaseline':
      return { ...cleared(s), baselineAutomationIds: [...a.automationIds].sort() };
    case 'setLimits':
      return { ...cleared(s), limits: a.limits };
    case 'setObjective':
      return { ...cleared(s), objective: a.objective };
    case 'setEconomics':
      // economics never change policy semantics, but rankings/economics depend on them: invalidate synthesis only
      return { ...s, bundle: { ...s.bundle, economics: a.economics }, synthesis: idle, replay: s.replay };
    case 'loadBundle': {
      const suite = a.bundle.suites.find((x) => x.id === s.suiteId) ?? a.bundle.suites.find((x) => x.id === SUITE_DEFAULT) ?? a.bundle.suites[0]!;
      return {
        ...cleared(s),
        bundle: a.bundle,
        bundleSource: a.source,
        suiteId: suite.id,
        caseIds: a.caseIds ?? [...suite.caseIds],
        variantIds: a.variantIds ?? [],
        design: a.design ?? { automationIds: [], controlIds: [] },
        baselineAutomationIds: a.baselineAutomationIds ? [...a.baselineAutomationIds].sort() : [],
        objective: a.objective ?? s.objective,
        limits: a.limits ?? { ...DEFAULT_LIMITS },
        importedWitnesses: a.witnesses ?? [],
        notices: [],
      };
    }
    case 'reset':
      return { ...initialState(), tab: s.tab, overlays: s.overlays };
    case 'runStarted':
      return { ...s, [a.slot]: { status: 'running', requestId: a.requestId, completed: 0, total: a.total, label: a.label } } as AppState;
    case 'runProgress':
      return setSlot(s, a.slot, a.requestId, { status: 'running', requestId: a.requestId, completed: a.completed, total: a.total, label: a.label });
    case 'analysisDone':
      return setSlot(s, 'analysis', a.requestId, { status: 'done', value: a.value, hashes: a.hashes, durationMs: a.durationMs });
    case 'diffDone':
      return setSlot(s, 'diff', a.requestId, { status: 'done', value: a.value, hashes: a.hashes, durationMs: a.durationMs });
    case 'compositionDone':
      return setSlot(s, 'composition', a.requestId, { status: 'done', value: a.value, hashes: a.hashes, durationMs: a.durationMs });
    case 'synthesisDone':
      return setSlot(s, 'synthesis', a.requestId, { status: 'done', value: a.value, hashes: a.hashes, durationMs: a.durationMs });
    case 'runFailed':
      return setSlot(s, a.slot, a.requestId, { status: 'failed', message: a.message });
    case 'cancelAll': {
      const c = <T,>(x: Slot<T>): Slot<T> => (x.status === 'running' ? { status: 'cancelled' } : x);
      return { ...s, analysis: c(s.analysis), diff: c(s.diff), composition: c(s.composition), synthesis: c(s.synthesis), replay: s.replay?.status === 'running' ? null : s.replay };
    }
    case 'replayStarted':
      return { ...s, replay: { witnessId: a.witnessId, status: 'running' } };
    case 'replayDone':
      return s.replay?.witnessId === a.witnessId ? { ...s, replay: { witnessId: a.witnessId, status: 'done', result: a.result } } : s;
    case 'replayFailed':
      return s.replay?.witnessId === a.witnessId ? { ...s, replay: { witnessId: a.witnessId, status: 'failed', message: a.message } } : s;
    case 'setTab':
      return { ...s, tab: a.tab };
    case 'select':
      return { ...s, selection: a.selection, replay: a.selection?.type === 'finding' || a.selection?.type === 'step' ? s.replay : null };
    case 'setOverlay':
      return { ...s, overlays: { ...s.overlays, [a.overlay]: a.on } };
    case 'previewAutomation':
      return s.previewAutomationId === a.id ? s : { ...s, previewAutomationId: a.id };
    case 'notice':
      return { ...s, notices: [...s.notices, a.notice].slice(-5) };
    case 'dismissNotices':
      return { ...s, notices: [] };
  }
}

const StateCtx = createContext<AppState | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState {
  const s = useContext(StateCtx);
  if (!s) throw new Error('useAppState outside AppProvider');
  return s;
}
export function useDispatch(): Dispatch<Action> {
  const d = useContext(DispatchCtx);
  if (!d) throw new Error('useDispatch outside AppProvider');
  return d;
}

/**
 * Contract implemented by `useReasoner.ts` (ReasonerProvider / useReasoner). Results are delivered through the reducer actions above;
 * every method builds a ReasonerRequest from the *current* AppState, ignores stale response ids, and terminates/recreates the
 * native worker on cancel.
 */
export interface ReasonerApi {
  /** True while any run is in flight. */
  busy: boolean;
  /** Analyze the current design (baseline analysis) and, when baselineAutomationIds differs from the design, also compare. */
  analyze: () => void;
  compare: () => void;
  runComposition: () => void;
  runSynthesis: () => void;
  /** Replay a witness against the current model/design via the engine. */
  replay: (witness: Witness) => void;
  cancel: () => void;
}
