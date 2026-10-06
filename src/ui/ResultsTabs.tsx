import { useRef, type KeyboardEvent } from 'react';
import { AssumptionsPanel } from './AssumptionsPanel';
import { CompositionPanel } from './CompositionPanel';
import { FindingsPanel } from './FindingsPanel';
import { RepairComparison, useApplyRepair } from './RepairComparison';
import { useAppState, useDispatch, type TabId } from './state';
import './results.css';

const TABS: { id: TabId; label: string }[] = [
  { id: 'findings', label: 'Findings' },
  { id: 'composition', label: 'Composition' },
  { id: 'repairs', label: 'Repairs' },
  { id: 'assumptions', label: 'Assumptions' },
];

export function ResultsTabs() {
  const { tab } = useAppState();
  const dispatch = useDispatch();
  const applyRepair = useApplyRepair();
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ findings: null, composition: null, repairs: null, assumptions: null });

  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    const target = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (target === null) return;
    e.preventDefault();
    const next = TABS[target]!;
    dispatch({ type: 'setTab', tab: next.id });
    tabRefs.current[next.id]?.focus();
  };

  return (
    <section className="results-tabs panel" aria-label="Results">
      <div role="tablist" aria-label="Results" className="results-tablist">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`results-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => dispatch({ type: 'setTab', tab: t.id })}
            onKeyDown={(e) => move(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="results-panel">
        {tab === 'findings' ? <FindingsPanel /> : null}
        {tab === 'composition' ? <CompositionPanel /> : null}
        {tab === 'repairs' ? <RepairComparison onApply={applyRepair} /> : null}
        {tab === 'assumptions' ? <AssumptionsPanel /> : null}
      </div>
    </section>
  );
}
