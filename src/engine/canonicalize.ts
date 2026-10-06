import type { ExecutionState } from '../model/types';

/** Deterministic JSON: object keys sorted; arrays keep their (already declared/sorted) order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Non-cryptographic 53-bit string hash (cyrb53). Used only to bind/compare, never to merge states. */
export function shortHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Exact behavioral key of a state: every fact, asset field and evidence record that can influence
 * future transitions, validity, counters or policy evaluation. Display text and event order excluded.
 */
export function stateKey(state: ExecutionState): string {
  const facts = Object.keys(state.facts)
    .sort()
    .map((k) => [k, state.facts[k]]);
  const assets = Object.keys(state.assets)
    .sort()
    .map((k) => {
      const a = state.assets[k]!;
      return [k, a.status, Object.keys(a.fields).sort().map((f) => [f, a.fields[f]!.value, a.fields[f]!.lineage, a.fields[f]!.categories, a.fields[f]!.purposes])];
    });
  const evidence = state.evidence
    .map((e) => JSON.stringify([e.kind, e.issuer, canonicalJson(e.subject), e.method, e.sources, e.validFrom, e.validUntil, e.escalation, e.caseScope, e.provenance, e.issuedBy]))
    .sort();
  return JSON.stringify([facts, assets, evidence]);
}

export function cloneState(s: ExecutionState): ExecutionState {
  const assets: ExecutionState['assets'] = {};
  for (const k of Object.keys(s.assets)) {
    const a = s.assets[k]!;
    const fields: typeof a.fields = {};
    for (const f of Object.keys(a.fields)) {
      const fv = a.fields[f]!;
      fields[f] = { value: fv.value, lineage: fv.lineage, categories: fv.categories, purposes: fv.purposes };
    }
    assets[k] = { ...a, fields };
  }
  return { facts: { ...s.facts }, assets, evidence: s.evidence.slice() };
}

export function sortedUnique(xs: readonly string[]): string[] {
  return Array.from(new Set(xs)).sort();
}
