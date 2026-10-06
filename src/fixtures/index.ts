import assumptionsJson from './assumptions.json';
import casesJson from './cases.json';
import northstarJson from './northstar.json';
import { parseBundle } from '../model/validate';
import type { ModelBundle } from '../model/types';

/** Assemble and validate the bundled Northstar model. Throws if the bundled fixtures are invalid. */
export function loadBundledBundle(): ModelBundle {
  const r = parseBundle({ ...northstarJson, ...casesJson, ...assumptionsJson });
  if (!r.ok) throw new Error(`Bundled Northstar fixture is invalid:\n${r.reasons.join('\n')}`);
  return r.bundle;
}

export const SUITE_DEFAULT = 'flagship';
