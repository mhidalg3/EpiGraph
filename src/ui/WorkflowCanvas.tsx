import { Background, Controls, MarkerType, ReactFlow, type Edge, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import type { TupleRef } from '../model/types';
import { AutomationLegend } from './AutomationLegend';
import { automationColor, automationImpacts } from './automationImpact';
import {
  ActivityNode,
  type NodeImpact,
  LaneNode,
  NoteNode,
  SystemNode,
  handleId,
  type ActivityFlowNode,
  type FlowNode,
  type HandleSide,
  type NoteFlowNode,
  type SystemFlowNode,
} from './ActivityNode';
import './graph.css';
import { LANE_BANDS, NODE_WIDTH, activityPosition, notePosition, systemPosition, type Point } from './layout';
import { useAppState, useDispatch, type Overlays } from './state';
import {
  deriveGraph,
  describeActivities,
  resolveSelectedWitness,
  useEffectiveModel,
  type ActivityView,
  type DerivedEdge,
  type DerivedGraph,
  type OverlayKind,
  type SelectedWitness,
} from './useEffectiveModel';

const NODE_TYPES: NodeTypes = { activity: ActivityNode, note: NoteNode, system: SystemNode, lane: LaneNode };

/** Marker colours mirror the CSS variables (SVG marker attributes cannot read custom properties reliably). */
const MARKER_COLOR: Record<OverlayKind, string> = { dependency: '#14284b', data: '#0f766e', authority: '#b45309' };

const OVERLAY_LABEL: Record<OverlayKind, { name: string; line: string }> = {
  dependency: { name: 'Dependency', line: 'solid' },
  data: { name: 'Data flow', line: 'dashed' },
  authority: { name: 'Authority / evidence', line: 'dotted' },
};
const OVERLAY_ORDER: readonly OverlayKind[] = ['dependency', 'data', 'authority'];

const tupleText = (t: TupleRef): string => `${t.kind} ${t.objectId} v${t.version}${t.detail ? ` (${t.detail})` : ''}`;

interface Route {
  sourceSide: HandleSide;
  targetSide: HandleSide;
}

/** Same-row neighbours connect side to side; other same-row pairs loop beneath; cross-row pairs connect vertically. */
function route(from: Point, to: Point): Route {
  if (from.y === to.y) {
    if (to.x < from.x) return { sourceSide: 'left', targetSide: 'right' };
    return to.x - from.x <= NODE_WIDTH + 100 ? { sourceSide: 'right', targetSide: 'left' } : { sourceSide: 'bottom', targetSide: 'bottom' };
  }
  return to.y > from.y ? { sourceSide: 'bottom', targetSide: 'top' } : { sourceSide: 'top', targetSide: 'bottom' };
}

function overlayEdge(edge: DerivedEdge, positions: Map<string, Point>): Edge | null {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return null;
  const r = route(from, to);
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    sourceHandle: handleId(r.sourceSide, edge.overlay, 'source'),
    targetHandle: handleId(r.targetSide, edge.overlay, 'target'),
    type: 'smoothstep',
    label: edge.label,
    className: `wf-edge wf-edge--${edge.overlay}`,
    markerEnd: { type: MarkerType.ArrowClosed, color: MARKER_COLOR[edge.overlay] },
    labelShowBg: true,
    labelBgBorderRadius: 4,
    labelBgPadding: [4, 2],
    selectable: false,
    focusable: false,
  };
}

function witnessSteps(selected: SelectedWitness | null): Map<string, number[]> {
  const byActivity = new Map<string, number[]>();
  for (const step of selected?.witness.steps ?? []) byActivity.set(step.activityId, [...(byActivity.get(step.activityId) ?? []), step.index + 1]);
  return byActivity;
}

/** Extra small nodes exist only for a selected finding: the focused step's tuples and the violation reasons. */
function noteSpecs(selected: SelectedWitness): { activityId: string; node: Omit<NoteFlowNode, 'position'> }[] {
  const { witness, focusIndex } = selected;
  const focus = witness.steps[focusIndex];
  const violationStep = witness.steps[witness.violation.stepIndex];
  const specs: { activityId: string; node: Omit<NoteFlowNode, 'position'> }[] = [];
  if (focus) {
    const n = focus.index + 1;
    specs.push(
      { activityId: focus.activityId, node: { id: `note-consumed-${n}`, type: 'note', data: { title: `Step ${n} consumes`, lines: focus.consumed.length > 0 ? focus.consumed.map(tupleText) : ['nothing'], tone: 'info' }, selectable: false, draggable: false, focusable: false } },
      { activityId: focus.activityId, node: { id: `note-produced-${n}`, type: 'note', data: { title: `Step ${n} produces`, lines: focus.produced.length > 0 ? focus.produced.map(tupleText) : ['nothing'], tone: 'info' }, selectable: false, draggable: false, focusable: false } },
    );
  }
  if (violationStep) {
    const n = violationStep.index + 1;
    specs.push({
      activityId: violationStep.activityId,
      node: {
        id: 'note-violation',
        type: 'note',
        data: { title: `${witness.violation.policyId} fails at step ${n}`, lines: [witness.violation.message, ...witness.violation.reasons], tone: 'bad' },
        selectable: false,
        draggable: false,
        focusable: false,
      },
    });
  }
  return specs;
}

interface FlowGraph {
  nodes: FlowNode[];
  edges: Edge[];
}

function buildFlow(
  views: ActivityView[],
  derived: DerivedGraph,
  overlays: Overlays,
  selected: SelectedWitness | null,
  selectedActivityId: string | null,
  impactsByActivity: Map<string, NodeImpact[]>,
): FlowGraph {
  const stepsByActivity = witnessSteps(selected);
  const focusActivity = selected?.witness.steps[selected.focusIndex]?.activityId ?? null;
  const fallbackIndex = new Map(views.map((v, i) => [v.id, i]));
  const positions = new Map(views.map((v, i) => [v.id, activityPosition(v.id, i)]));

  const nodes: FlowNode[] = LANE_BANDS.map((lane) => ({
    id: `lane-${lane.id}`,
    type: 'lane',
    position: { x: lane.x, y: lane.y },
    data: { label: lane.label },
    style: { width: lane.width, height: lane.height },
    zIndex: -1,
    selectable: false,
    draggable: false,
    focusable: false,
    connectable: false,
  }));

  for (const view of views) {
    const steps = stepsByActivity.get(view.id) ?? [];
    const focusStep = selected !== null && view.id === focusActivity;
    const node: ActivityFlowNode = {
      id: view.id,
      type: 'activity',
      position: positions.get(view.id)!,
      data: { view, steps, focusStep, dimmed: selected !== null && steps.length === 0, impacts: impactsByActivity.get(view.id) ?? [] },
      selected: view.id === selectedActivityId,
      draggable: false,
      connectable: false,
      deletable: false,
      focusable: false,
    };
    nodes.push(node);
  }

  const edges: Edge[] = [];
  for (const edge of derived.edges) {
    if (!overlays[edge.overlay]) continue;
    const e = overlayEdge(edge, positions);
    if (e) edges.push(e);
  }

  if (overlays.data) {
    const perActivity = new Map<string, number>();
    for (const t of derived.transfers) {
      const from = positions.get(t.from);
      if (!from) continue;
      const slot = perActivity.get(t.from) ?? 0;
      perActivity.set(t.from, slot + 1);
      const system: SystemFlowNode = {
        id: `system-${t.id}`,
        type: 'system',
        position: systemPosition(t.from, fallbackIndex.get(t.from) ?? 0, slot),
        data: { name: t.systemName, external: t.external },
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
      };
      nodes.push(system);
      edges.push({
        id: `transfer-${t.id}`,
        source: t.from,
        target: system.id,
        sourceHandle: handleId('bottom', 'data', 'source'),
        targetHandle: handleId('top', 'data', 'target'),
        type: 'smoothstep',
        label: `${t.external ? 'EXTERNAL transfer' : 'transfer'}: ${t.fieldCount} fields, ${t.purpose}`,
        className: `wf-edge wf-edge--data wf-edge--transfer${t.external ? ' wf-edge--external' : ''}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: MARKER_COLOR.data },
        labelShowBg: true,
        labelBgBorderRadius: 4,
        labelBgPadding: [4, 2],
        selectable: false,
        focusable: false,
      });
    }
  }

  if (selected) {
    const grouped = new Map<string, Omit<NoteFlowNode, 'position'>[]>();
    for (const spec of noteSpecs(selected)) if (positions.has(spec.activityId)) grouped.set(spec.activityId, [...(grouped.get(spec.activityId) ?? []), spec.node]);
    for (const [activityId, group] of grouped)
      group.forEach((node, i) => nodes.push({ ...node, position: notePosition(activityId, fallbackIndex.get(activityId) ?? 0, group.length, i) }));
  }
  return { nodes, edges };
}

function LegendLine({ overlay }: { overlay: OverlayKind }) {
  return (
    <svg width="46" height="10" aria-hidden="true" className="wf-legend__sample">
      <line x1="2" y1="5" x2="44" y2="5" className={`wf-legend__line wf-legend__line--${overlay}`} />
    </svg>
  );
}

export function WorkflowCanvas() {
  const state = useAppState();
  const dispatch = useDispatch();
  const { baseline, effective, error } = useEffectiveModel();

  const selectedWitness = useMemo(() => resolveSelectedWitness(state.selection, state.analysis), [state.selection, state.analysis]);
  const views = useMemo(() => (effective ? describeActivities(baseline, effective) : []), [baseline, effective]);
  const derived = useMemo(() => (effective ? deriveGraph(effective) : { edges: [], transfers: [] }), [effective]);
  const effectiveIds = effective?.effective.effectiveAutomationIds;
  const impactsByActivity = useMemo(() => {
    const byActivity = new Map<string, NodeImpact[]>();
    for (const a of state.bundle.automations) {
      const active = effectiveIds?.includes(a.id) ?? false;
      if (!active && a.id !== state.previewAutomationId) continue;
      const color = automationColor(state.bundle, a.id);
      // Active chips: only what still holds after controls (e.g. C2 restores W09). Previews: the raw automation patch.
      for (const i of automationImpacts(state.bundle, a.id, active ? (effective ?? undefined) : undefined))
        byActivity.set(i.activityId, [...(byActivity.get(i.activityId) ?? []), { ...i, color, active }]);
    }
    return byActivity;
  }, [state.bundle, state.previewAutomationId, effective, effectiveIds]);
  const selectedActivityId =
    state.selection?.type === 'activity'
      ? state.selection.id
      : state.selection?.type === 'step'
        ? (selectedWitness?.witness.steps[selectedWitness.focusIndex]?.activityId ?? null)
        : null;
  const flow = useMemo(
    () => buildFlow(views, derived, state.overlays, selectedWitness, selectedActivityId, impactsByActivity),
    [views, derived, state.overlays, selectedWitness, selectedActivityId, impactsByActivity],
  );

  return (
    <section className="wf-canvas" aria-label="Workflow graph">
      <p className="sr-only">
        The graph is a supplementary view of the workflow. The complete ordered witness path for every finding is available in the Findings tab as a keyboard-accessible table. Activity nodes are
        buttons: press Enter or Space to inspect one.
      </p>
      <div className="wf-canvas__toolbar">
        <fieldset className="wf-overlays">
          <legend>Overlays</legend>
          {OVERLAY_ORDER.map((overlay) => (
            <label key={overlay} className="wf-overlays__item">
              <input type="checkbox" checked={state.overlays[overlay]} onChange={(e) => dispatch({ type: 'setOverlay', overlay, on: e.target.checked })} />
              {`${OVERLAY_LABEL[overlay].name} (${OVERLAY_LABEL[overlay].line})`}
            </label>
          ))}
        </fieldset>
        <section className="wf-legend" aria-labelledby="wf-legend-title">
          <h3 id="wf-legend-title" className="wf-legend__title">
            Edge legend
          </h3>
          <ul className="wf-legend__list">
            {OVERLAY_ORDER.map((overlay) => (
              <li key={overlay}>
                <LegendLine overlay={overlay} />
                {`${OVERLAY_LABEL[overlay].line} = ${OVERLAY_LABEL[overlay].name.toLowerCase()}`}
              </li>
            ))}
          </ul>
        </section>
        <AutomationLegend effectiveIds={effectiveIds} />
        <p className="wf-canvas__design">
          <strong>Design shown:</strong> {state.design.automationIds.join(' + ') || 'Manual (no automations)'}
          {state.design.controlIds.length > 0 ? `, controls ${state.design.controlIds.join(' + ')}` : ', no controls'} · <strong>Compared against:</strong>{' '}
          {state.baselineAutomationIds.join(' + ') || 'Manual (no automations)'}
        </p>
        <p className="wf-canvas__focus" aria-live="polite">
          {selectedWitness
            ? `Highlighting the witness for ${selectedWitness.finding?.policyId ?? 'goal failure'} in case ${selectedWitness.witness.caseId}; step ${selectedWitness.focusIndex + 1} of ${selectedWitness.witness.steps.length} in focus.`
            : 'No finding selected: plain activity backbone.'}
        </p>
      </div>
      <div className="wf-canvas__viewport">
        {error || !effective ? (
          <p className="wf-canvas__error" role="alert">
            {`The selected inputs do not compile into a model: ${error ?? 'unknown error'}`}
          </p>
        ) : (
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.06 }}
            minZoom={0.12}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            edgesReconnectable={false}
            elementsSelectable
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            onPaneClick={() => dispatch({ type: 'select', selection: null })}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </section>
  );
}
