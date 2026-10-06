import type { ReactNode } from 'react';
import type { Slot } from './state';

/**
 * Renders the non-result states of a result slot (idle / running / failed / cancelled).
 * Returns null for `done`: the caller then renders the value, so no verdict can appear before a real run.
 */
export function SlotStatus({ slot, idle, subject }: { slot: Slot<unknown>; idle: ReactNode; subject: string }) {
  switch (slot.status) {
    case 'idle':
      return <p className="results-empty">{idle}</p>;
    case 'running':
      return (
        <div className="results-empty results-empty--running" role="status">
          <progress max={Math.max(slot.total, 1)} value={slot.completed} aria-label={`${subject} progress`} />
          <span>
            {subject} running: {slot.completed} of {slot.total} — {slot.label}
          </span>
        </div>
      );
    case 'failed':
      return (
        <p className="results-empty results-empty--failed" role="alert">
          <span aria-hidden="true">✕ </span>
          {subject} failed: {slot.message}. No result is shown.
        </p>
      );
    case 'cancelled':
      return (
        <p className="results-empty results-empty--cancelled" role="status">
          <span aria-hidden="true">– </span>
          {subject} was cancelled. No result is shown.
        </p>
      );
    case 'done':
      return null;
  }
}
