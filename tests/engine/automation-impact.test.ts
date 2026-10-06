import { describe, expect, it } from 'vitest';
import { compileDesign } from '../../src/engine/compile';
import { automationImpacts } from '../../src/ui/automationImpact';
import { describeActivities } from '../../src/ui/useEffectiveModel';
import { freshBundle } from '../helpers';

const bundle = freshBundle();
const ids = (a: string) => automationImpacts(bundle, a).map((i) => i.activityId);
const compiled = (automationIds: string[], controlIds: string[] = []) => {
  const c = compileDesign(bundle, { automationIds, controlIds });
  if (!c.ok) throw new Error(c.reasons.join('; '));
  return c.model;
};

describe('automation impact on workflow activities', () => {
  it('lists the steps each automation changes, in canvas order', () => {
    expect(ids('A1')).toEqual(['W06']);
    expect(ids('A2')).toEqual(['W02', 'W03', 'W04']);
    expect(ids('A3')).toEqual(['W08', 'W09', 'W10', 'W11']);
  });

  it('marks steps an automation deletes as removed', () => {
    const kinds = (a: string, w: string) => automationImpacts(bundle, a).find((i) => i.activityId === w)!.kinds;
    expect(kinds('A2', 'W03')).toContain('removed');
    expect(kinds('A3', 'W09')).toContain('removed');
    expect(kinds('A2', 'W02')).not.toContain('removed');
  });

  it('covers every step the compiled design actually changes, so no "Changed" node lacks an automation chip', () => {
    for (const automation of ['A1', 'A2', 'A3']) {
      const views = describeActivities(compiled([]), compiled([automation]));
      const changed = views.filter((v) => v.changed || v.status === 'removed').map((v) => v.id);
      const effective = automationImpacts(bundle, automation, compiled([automation])).map((i) => i.activityId);
      expect(effective, automation).toEqual(expect.arrayContaining(changed));
    }
  });

  it('drops impacts a control undoes in the compiled design (C2 restores W09, C1 restores W03 and its W04 control)', () => {
    const kindsAt = (a: string, controls: string[], w: string) =>
      automationImpacts(bundle, a, compiled(['A2', 'A3'], controls)).find((i) => i.activityId === w)?.kinds ?? [];
    expect(kindsAt('A3', [], 'W09')).toContain('removed');
    expect(kindsAt('A3', ['C2'], 'W09')).not.toContain('removed');
    expect(kindsAt('A2', ['C1'], 'W03')).not.toContain('removed');
    expect(kindsAt('A2', ['C1'], 'W04')).toEqual(['actor']);
  });

  it('keeps A1 rewritten on W06 when C4 adds a control to that contract', () => {
    const w06 = automationImpacts(bundle, 'A1', compiled(['A1'], ['C4'])).find((i) => i.activityId === 'W06');
    expect(w06?.kinds).toContain('contract');
  });
});
