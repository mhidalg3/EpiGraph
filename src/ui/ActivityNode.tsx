import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import './graph.css';
import { useDispatch } from './state';
import type { ActivityView, OverlayKind } from './useEffectiveModel';
import { IMPACT_SHORT, type ImpactKind } from './automationImpact';

/** One automation touching this activity. `active`: part of the design on screen; otherwise it is a hover preview ("would change"). */
export type NodeImpact = { automationId: string; color: string; kinds: ImpactKind[]; notes: string[]; active: boolean };
export type ActivityNodeData = {
  view: ActivityView;
  /** 1-based witness step numbers that execute this activity (empty when no finding is selected). */
  steps: number[];
  /** True when this activity executes the step currently focused in the witness. */
  focusStep: boolean;
  /** True when a witness is selected and this activity is not part of it. */
  dimmed: boolean;
  /** Automations that change this activity (active ones always; a previewed one while hovered). */
  impacts: NodeImpact[];
};
export type ActivityFlowNode = Node<ActivityNodeData, 'activity'>;

export type NoteNodeData = { title: string; lines: string[]; tone: 'info' | 'bad' };
export type NoteFlowNode = Node<NoteNodeData, 'note'>;

export type SystemNodeData = { name: string; external: boolean };
export type SystemFlowNode = Node<SystemNodeData, 'system'>;

export type LaneNodeData = { label: string };
export type LaneFlowNode = Node<LaneNodeData, 'lane'>;

export type FlowNode = ActivityFlowNode | NoteFlowNode | SystemFlowNode | LaneFlowNode;

// ---------- handles ----------

export type HandleSide = 'left' | 'right' | 'top' | 'bottom';
export type HandleRole = 'source' | 'target';

const SIDE_POSITION: Record<HandleSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

/** Each overlay/role pair owns a distinct anchor along every side so edges of different overlays never coincide. */
const ANCHOR_PERCENT: Record<OverlayKind, Record<HandleRole, number>> = {
  dependency: { target: 41, source: 59 },
  data: { target: 28, source: 72 },
  authority: { target: 15, source: 85 },
};

const OVERLAYS: readonly OverlayKind[] = ['dependency', 'data', 'authority'];
const SIDES: readonly HandleSide[] = ['left', 'right', 'top', 'bottom'];
const ROLES: readonly HandleRole[] = ['source', 'target'];

export const handleId = (side: HandleSide, overlay: OverlayKind, role: HandleRole): string => `${side}-${overlay}-${role}`;

function HandleSet() {
  return (
    <>
      {SIDES.flatMap((side) =>
        OVERLAYS.flatMap((overlay) =>
          ROLES.map((role) => (
            <Handle
              key={handleId(side, overlay, role)}
              id={handleId(side, overlay, role)}
              type={role}
              position={SIDE_POSITION[side]}
              isConnectable={false}
              className="graph-handle"
              style={side === 'left' || side === 'right' ? { top: `${ANCHOR_PERCENT[overlay][role]}%` } : { left: `${ANCHOR_PERCENT[overlay][role]}%` }}
            />
          )),
        ),
      )}
    </>
  );
}

// ---------- activity node ----------

type TagTone = 'neutral' | 'info' | 'warn' | 'bad';

function Tag({ tone, icon, children }: { tone: TagTone; icon: string; children: string }) {
  return (
    <span className={`act-tag act-tag--${tone}`}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </span>
  );
}

const ACTOR_TAG: Record<'human' | 'service' | 'external', { text: string; icon: string; tone: TagTone }> = {
  human: { text: 'Manual', icon: '○', tone: 'neutral' },
  service: { text: 'Automated', icon: '▣', tone: 'info' },
  external: { text: 'External', icon: '⇄', tone: 'warn' },
};

export function ActivityNode({ data, selected }: NodeProps<ActivityFlowNode>) {
  const dispatch = useDispatch();
  const { view, steps, focusStep, dimmed, impacts } = data;
  const accent = impacts.find((i) => i.active) ?? impacts[0];
  const previewed = impacts.some((i) => !i.active);
  const actor = view.actorKind ? ACTOR_TAG[view.actorKind] : null;
  const classes = [
    'act-node',
    view.status !== 'present' ? 'act-node--removed' : '',
    impacts.some((i) => i.active) ? 'act-node--impacted' : '',
    previewed ? 'act-node--preview' : '',
    selected ? 'act-node--selected' : '',
    steps.length > 0 ? 'act-node--witness' : '',
    focusStep ? 'act-node--focus' : '',
    dimmed ? 'act-node--dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} style={accent ? ({ '--auto-color': accent.color } as CSSProperties) : undefined}>
      <HandleSet />
      <button type="button" className="act-node__button nodrag nopan" aria-pressed={selected} onClick={() => dispatch({ type: 'select', selection: { type: 'activity', id: view.id } })}>
        <span className="act-node__head">
          <span className="act-node__id">{view.id}</span>
          <span className="act-node__name">{view.name}</span>
        </span>
        <span className="act-node__actor">{view.actorName ?? 'No actor'}</span>
        <span className="act-node__tags">
          {actor && view.status === 'present' && (
            <Tag tone={actor.tone} icon={actor.icon}>
              {actor.text}
            </Tag>
          )}
          {view.conditional && (
            <Tag tone="neutral" icon="?">
              Conditional
            </Tag>
          )}
          {view.changed && (
            <Tag tone="warn" icon="Δ">
              Changed
            </Tag>
          )}
          {steps.length > 0 && (
            <Tag tone={focusStep ? 'bad' : 'info'} icon="#">
              {`${steps.length === 1 ? 'Step' : 'Steps'} ${steps.join(', ')}`}
            </Tag>
          )}
        </span>
        {view.controlIds.length > 0 && (
          <span className="act-node__controls">
            {view.controlIds.map((id) => (
              <span key={id} className="act-chip">
                {id}
              </span>
            ))}
          </span>
        )}
        {impacts.length > 0 && (
          <span className="act-node__autos">
            {impacts.map((i) => (
              <span
                key={i.automationId}
                className={`act-auto${i.active ? '' : ' act-auto--preview'}`}
                style={{ '--auto-color': i.color } as CSSProperties}
                title={`${i.automationId}${i.active ? '' : ' (preview, not applied in the design shown)'}: ${i.notes.join('; ')}`}
              >
                {`${i.automationId} · ${i.kinds.map((k) => IMPACT_SHORT[k]).join(', ')}`}
                {!i.active && <span className="sr-only"> (preview: not applied in the design shown)</span>}
              </span>
            ))}
          </span>
        )}
        {view.status === 'removed' && (
          <span className="act-node__removed">
            <span aria-hidden="true">⊘ </span>
            {`Removed by ${view.removedBy.join(', ')}`}
          </span>
        )}
        {view.status === 'absent' && (
          <span className="act-node__removed">
            <span aria-hidden="true">⊘ </span>No contract in this model
          </span>
        )}
      </button>
    </div>
  );
}

// ---------- supporting nodes ----------

export function NoteNode({ data }: NodeProps<NoteFlowNode>) {
  return (
    <div className={`graph-note graph-note--${data.tone} nodrag nopan nowheel`} role="note" tabIndex={0}>
      <strong className="graph-note__title">{data.title}</strong>
      <ul className="graph-note__lines">
        {data.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function SystemNode({ data }: NodeProps<SystemFlowNode>) {
  return (
    <div className={`graph-system ${data.external ? 'graph-system--external' : ''}`}>
      <HandleSet />
      <span className="graph-system__boundary">
        <span aria-hidden="true">{data.external ? '⇄ ' : '▢ '}</span>
        {data.external ? 'External system' : 'Internal system'}
      </span>
      <span className="graph-system__name">{data.name}</span>
    </div>
  );
}

export function LaneNode({ data }: NodeProps<LaneFlowNode>) {
  return (
    <div className="graph-lane" aria-hidden="true">
      <span className="graph-lane__label">{data.label}</span>
    </div>
  );
}
