import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info';

const ICON: Record<Tone, string> = { ok: '✓', warn: '?', bad: '✕', neutral: '•', info: 'i' };

/** Status chip: text + icon + color (never color alone). Styles live in styles.css (.badge, .badge--ok …). */
export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      <span aria-hidden="true" className="badge__icon">
        {ICON[tone]}
      </span>
      {children}
    </span>
  );
}

export const analysisTone = (s: string): Tone => (s === 'complete' ? 'ok' : s === 'partial' ? 'warn' : s === 'invalid' ? 'bad' : 'neutral');
export const policyTone = (s: string): Tone => (s === 'satisfied_in_model' ? 'ok' : s === 'violated' ? 'bad' : 'warn');
export const goalTone = (s: string): Tone => (s === 'satisfied' ? 'ok' : s === 'failed' ? 'bad' : 'warn');
export const optimizationTone = (s: string): Tone => (s === 'optimal_in_catalog' ? 'ok' : s === 'best_verified_found' ? 'info' : s === 'no_feasible_design' ? 'bad' : 'warn');

export const usd = (n: number): string =>
  `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
