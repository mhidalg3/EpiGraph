import type { ActivityEntity } from '../model/types';
import { automationColor, automationImpacts, impactSummary } from './automationImpact';
import { LANE_BANDS } from './layout';
import { useAppState, useDispatch } from './state';

interface Props {
  /** Automations that actually apply in the compiled design (after controls); undefined when the design does not compile. */
  effectiveIds: readonly string[] | undefined;
}

/** Which automations are in the design and which workflow steps each one changes; hover/focus previews it on the graph. */
export function AutomationLegend({ effectiveIds }: Props) {
  const { bundle, design } = useAppState();
  const dispatch = useDispatch();
  const laneOf = new Map(bundle.entities.filter((e): e is ActivityEntity => e.kind === 'Activity').map((e) => [e.id, e.lane]));
  const preview = (id: string | null) => dispatch({ type: 'previewAutomation', id });

  return (
    <section className="wf-autos" aria-labelledby="wf-autos-title">
      <h3 id="wf-autos-title" className="wf-legend__title">
        Automation impact <span className="muted">(hover or focus one to preview it on the graph)</span>
      </h3>
      <ul className="wf-autos__list">
        {bundle.automations.map((a) => {
          const impacts = automationImpacts(bundle, a.id);
          const requested = design.automationIds.includes(a.id);
          const effective = effectiveIds?.includes(a.id) ?? false;
          const status = effective
            ? 'in design'
            : !requested
              ? 'not in design'
              : effectiveIds
                ? 'requested, switched off by a control'
                : 'requested; design does not compile';
          return (
            <li
              key={a.id}
              className={`wf-autos__row${effective ? ' wf-autos__row--on' : ''}`}
              tabIndex={0}
              onMouseEnter={() => preview(a.id)}
              onMouseLeave={() => preview(null)}
              onFocus={() => preview(a.id)}
              onBlur={() => preview(null)}
            >
              <span className="wf-autos__head">
                <span className="wf-autos__swatch" aria-hidden="true" style={{ background: automationColor(bundle, a.id) }} />
                <strong>{a.label}</strong>
                <span className={`wf-autos__status${effective ? ' wf-autos__status--on' : ''}`}>{status}</span>
              </span>
              <span className="wf-autos__steps">
                {LANE_BANDS.map((lane) => {
                  const inLane = impacts.filter((i) => laneOf.get(i.activityId) === lane.id);
                  return inLane.length > 0 ? (
                    <span key={lane.id} className="wf-autos__lane">
                      {`${lane.label}: ${impactSummary(inLane)}`}
                    </span>
                  ) : null;
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
