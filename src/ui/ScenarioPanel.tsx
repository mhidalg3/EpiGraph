import { useEffect, useId, useState } from 'react';
import type { AnalysisLimits, EconomicAssumptions } from '../model/types';
import { useAppState, useDispatch } from './state';
import { automationColor, automationImpacts, impactSummary } from './automationImpact';
import { useReasoner } from './useReasoner';

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  integer: boolean;
  /** Extra cross-field rule; return an error message or null. */
  check?: (n: number) => string | null;
  onValid: (n: number) => void;
}

/** Number input with local text state so partial typing works; only valid values are dispatched. */
function NumberField({ label, value, min, max, integer, check, onValid }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);

  const n = Number(text);
  let error: string | null = null;
  if (text.trim() === '' || !Number.isFinite(n)) error = 'Enter a finite number';
  else if (integer && !Number.isInteger(n)) error = 'Must be a whole number';
  else if (n < min || n > max) error = `Must be between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}`;
  else error = check?.(n) ?? null;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        className="num"
        value={text}
        min={min}
        max={max}
        step={integer ? 1 : 'any'}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const next = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(next) && next >= min && next <= max && (!integer || Number.isInteger(next)) && !check?.(next)) onValid(next);
        }}
      />
      {error && (
        <span id={`${id}-err`} className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function subsets(ids: readonly string[]): string[][] {
  return ids.reduce<string[][]>((acc, id) => [...acc, ...acc.map((s) => [...s, id])], [[]]).sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

export function ScenarioPanel() {
  const state = useAppState();
  const dispatch = useDispatch();
  const reasoner = useReasoner();
  const { bundle, limits } = state;
  const eco = bundle.economics;
  const suite = bundle.suites.find((s) => s.id === state.suiteId);
  const baselineOptions = subsets(bundle.automations.map((a) => a.id));

  const setLimit = (key: keyof AnalysisLimits, v: number) => dispatch({ type: 'setLimits', limits: { ...limits, [key]: v } });
  const setEco = (next: EconomicAssumptions) => dispatch({ type: 'setEconomics', economics: next });
  const setMonthly = (key: keyof EconomicAssumptions['monthly'], v: number) => setEco({ ...eco, monthly: { ...eco.monthly, [key]: v } });

  return (
    <aside className="panel scenario" aria-label="Scenario controls">
      <h2 className="panel__title">Scenario</h2>
      <div className="row scenario__actions">
        <button type="button" className="btn btn--primary" onClick={reasoner.analyze} disabled={reasoner.busy}>
          Analyze
        </button>
        <button type="button" className="btn" onClick={reasoner.cancel} disabled={!reasoner.busy}>
          Cancel
        </button>
      </div>
      <p className="muted scenario__hint">Edits clear every result. Reset restores the bundled Northstar inputs.</p>

      <fieldset className="stack">
        <legend>Automations</legend>
        <p className="muted">Tick the automations to analyze. Hover one to see which workflow steps it changes in the graph.</p>
        {bundle.automations.map((a) => {
          const impacts = automationImpacts(bundle, a.id);
          return (
            <div
              key={a.id}
              className="check"
              onMouseEnter={() => dispatch({ type: 'previewAutomation', id: a.id })}
              onMouseLeave={() => dispatch({ type: 'previewAutomation', id: null })}
              onFocus={() => dispatch({ type: 'previewAutomation', id: a.id })}
              onBlur={() => dispatch({ type: 'previewAutomation', id: null })}
            >
              <input id={`auto-${a.id}`} type="checkbox" checked={state.design.automationIds.includes(a.id)} aria-describedby={`auto-${a.id}-d auto-${a.id}-i`} onChange={() => dispatch({ type: 'toggleAutomation', id: a.id })} />
              <label htmlFor={`auto-${a.id}`}>
                <span className="check__swatch" aria-hidden="true" style={{ background: automationColor(bundle, a.id) }} />
                {a.label}
              </label>
              <span id={`auto-${a.id}-d`} className="muted check__desc">
                {a.description}
              </span>
              <span id={`auto-${a.id}-i`} className="check__impact">
                {`Changes ${impactSummary(impacts) || 'no workflow steps'}`}
              </span>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="stack">
        <legend>Controls</legend>
        {bundle.repairs.map((c) => (
          <div key={c.id} className="check">
            <input id={`ctl-${c.id}`} type="checkbox" checked={state.design.controlIds.includes(c.id)} aria-describedby={`ctl-${c.id}-d`} onChange={() => dispatch({ type: 'toggleControl', id: c.id })} />
            <label htmlFor={`ctl-${c.id}`}>{c.label}</label>
            <span id={`ctl-${c.id}-d`} className="muted check__desc">
              {c.description}
            </span>
          </div>
        ))}
      </fieldset>

      <section className="stack" aria-labelledby="sc-compare">
        <h3 id="sc-compare">Comparison</h3>
        <div className="field">
          <label htmlFor="sc-baseline">Compare against (reference design)</label>
          <select id="sc-baseline" value={state.baselineAutomationIds.join(',')} onChange={(e) => dispatch({ type: 'setBaseline', automationIds: e.target.value === '' ? [] : e.target.value.split(',') })}>
            {baselineOptions.map((ids) => (
              <option key={ids.join(',')} value={ids.join(',')}>
                {ids.length === 0 ? 'Manual (none)' : ids.join(' + ')}
              </option>
            ))}
          </select>
        </div>
        <p className="muted scenario__hint">This only chooses what the findings are compared with. It does not choose which automations are analyzed: tick those above.</p>
        {state.baselineAutomationIds.length > 0 && state.design.automationIds.length === 0 && (
          <p className="scenario__warn" role="status">
            {`No automation is ticked, so the analyzed design is Manual. ${state.baselineAutomationIds.join(' + ')} is only the reference: hazards it has will show as resolved.`}
          </p>
        )}
        <div className="field">
          <label htmlFor="sc-suite">Case suite</label>
          <select id="sc-suite" value={state.suiteId} onChange={(e) => dispatch({ type: 'setSuite', suiteId: e.target.value })}>
            {bundle.suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {suite && <p className="muted">{suite.description}</p>}
        <details>
          <summary>{state.caseIds.length} cases in this analysis</summary>
          <ul className="scenario__cases">
            {state.caseIds.map((id) => (
              <li key={id}>{bundle.cases.find((c) => c.id === id)?.label ?? id}</li>
            ))}
          </ul>
        </details>
      </section>

      <details className="scenario__variants">
        <summary>{`Model variants (${state.variantIds.length} selected)`}</summary>
        <fieldset className="stack">
          <legend className="sr-only">Model variants</legend>
          <p className="muted">Named hostile or what-if mutations applied to a fresh copy of the model before the design. Default: none.</p>
          {bundle.variants.length === 0 && <p className="muted">This model declares no variants.</p>}
          {bundle.variants.map((v) => (
            <div key={v.id} className="check">
              <input
                id={`var-${v.id}`}
                type="checkbox"
                checked={state.variantIds.includes(v.id)}
                aria-describedby={`var-${v.id}-d`}
                onChange={(e) => dispatch({ type: 'setVariants', variantIds: e.target.checked ? [...state.variantIds, v.id] : state.variantIds.filter((x) => x !== v.id) })}
              />
              <label htmlFor={`var-${v.id}`}>{v.label}</label>
              <span id={`var-${v.id}-d`} className="muted check__desc">
                {v.description}
              </span>
            </div>
          ))}
        </fieldset>
      </details>

      <section className="stack" aria-labelledby="sc-fixed">
        <h3 id="sc-fixed">Fixed inputs</h3>
        <dl className="scenario__facts">
          <dt>Analysis date</dt>
          <dd className="num">{bundle.analysisDate}</dd>
          <dt>Graph version</dt>
          <dd className="num">{bundle.graphVersion}</dd>
          <dt>Policy version</dt>
          <dd className="num">{bundle.policyVersion}</dd>
          <dt>Schema version</dt>
          <dd className="num">{bundle.schemaVersion}</dd>
        </dl>
      </section>

      <section className="stack" aria-labelledby="sc-limits">
        <h3 id="sc-limits">Analysis limits</h3>
        <NumberField label="Max states per case" value={limits.maxStatesPerCase} min={1} max={10_000_000} integer onValid={(n) => setLimit('maxStatesPerCase', n)} />
        <NumberField label="Max transitions per case" value={limits.maxTransitionsPerCase} min={1} max={100_000_000} integer onValid={(n) => setLimit('maxTransitionsPerCase', n)} />
        <NumberField label="Max designs" value={limits.maxDesigns} min={1} max={100_000} integer onValid={(n) => setLimit('maxDesigns', n)} />
      </section>

      <section className="stack" aria-labelledby="sc-econ">
        <h3 id="sc-econ">Economic assumptions</h3>
        <p className="muted">Synthetic and editable. Edits invalidate only the repair search; policy semantics are unchanged.</p>
        <div className="field">
          <label htmlFor="sc-objective">Objective</label>
          <select id="sc-objective" value={state.objective} onChange={(e) => dispatch({ type: 'setObjective', objective: e.target.value === 'maximum_value' ? 'maximum_value' : 'least_disruption' })}>
            <option value="least_disruption">Least disruption (repair requested design)</option>
            <option value="maximum_value">Maximum value (joint selection)</option>
          </select>
        </div>
        <NumberField
          label="Monthly invoices"
          value={eco.monthly.invoices}
          min={0}
          max={1_000_000}
          integer
          check={(n) => (n < eco.monthly.paidSupplierEvents ? 'Must be at least the paid supplier events' : null)}
          onValid={(n) => setMonthly('invoices', n)}
        />
        <NumberField
          label="Monthly supplier events"
          value={eco.monthly.supplierEvents}
          min={0}
          max={1_000_000}
          integer
          check={(n) => (n < eco.monthly.paidSupplierEvents ? 'Must be at least the paid supplier events' : null)}
          onValid={(n) => setMonthly('supplierEvents', n)}
        />
        <NumberField
          label="Paid supplier events"
          value={eco.monthly.paidSupplierEvents}
          min={0}
          max={1_000_000}
          integer
          check={(n) => (n > Math.min(eco.monthly.invoices, eco.monthly.supplierEvents) ? 'Must not exceed monthly invoices or supplier events' : null)}
          onValid={(n) => setMonthly('paidSupplierEvents', n)}
        />
        <NumberField label="Human hour value (USD)" value={eco.humanHourValueUsd} min={0.01} max={10_000} integer={false} onValid={(n) => setEco({ ...eco, humanHourValueUsd: n })} />
        <NumberField label="Review capacity (hours/month)" value={eco.reviewCapacityHours} min={0} max={100_000} integer={false} onValid={(n) => setEco({ ...eco, reviewCapacityHours: n })} />
        <NumberField label="Platform recurring (USD/month)" value={eco.platform.recurringUsd} min={0} max={100_000_000} integer={false} onValid={(n) => setEco({ ...eco, platform: { ...eco.platform, recurringUsd: n } })} />
        <NumberField label="Platform setup (USD)" value={eco.platform.setupUsd} min={0} max={100_000_000} integer={false} onValid={(n) => setEco({ ...eco, platform: { ...eco.platform, setupUsd: n } })} />
        <NumberField label="Amortization (months)" value={eco.amortizationMonths} min={1} max={120} integer onValid={(n) => setEco({ ...eco, amortizationMonths: n })} />
        {bundle.repairs.map((c) => {
          const cost = eco.controlCosts[c.id] ?? { recurringUsd: 0, setupUsd: 0 };
          return (
            <NumberField
              key={c.id}
              label={`${c.id} recurring (USD/month)`}
              value={cost.recurringUsd}
              min={0}
              max={100_000_000}
              integer={false}
              onValid={(n) => setEco({ ...eco, controlCosts: { ...eco.controlCosts, [c.id]: { ...cost, recurringUsd: n } } })}
            />
          );
        })}
      </section>
    </aside>
  );
}
