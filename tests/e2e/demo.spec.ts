import { expect, test, type Page } from '@playwright/test';

const A1 = 'A1 — Invoice extraction';
const A2 = 'A2 — Supplier maintenance';
const A3 = 'A3 — Payment preparation and submission';

const banner = (page: Page) => page.getByTestId('coverage-banner');
const analyze = async (page: Page) => {
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
};
const toggle = (page: Page, name: string) => page.getByRole('checkbox', { name }).click();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.getByText('Fictional finite-model demonstration')).toBeVisible();
  await expect(banner(page)).toContainText('No analysis yet');
  await expect(banner(page).getByText(/Policies:/)).toHaveCount(0);
  (page as Page & { __errors: string[] }).__errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { __errors: string[] }).__errors).toEqual([]);
});

test('baseline analysis reports an actual complete, satisfied result from the worker', async ({ page }) => {
  await analyze(page);
  await expect(banner(page).getByText('Coverage: complete')).toBeVisible();
  await expect(banner(page).getByText('Policies: satisfied in model')).toBeVisible();
  await expect(banner(page).getByText('Goals: satisfied')).toBeVisible();
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
  // an edit clears the affirmative verdict immediately
  await toggle(page, A2);
  await expect(banner(page)).toContainText('No analysis yet');
  await expect(banner(page).getByText('Policies: satisfied in model')).toHaveCount(0);
});

test('A2 and A3 are individually acceptable; together they expose a replayable P01 witness and the minimal set', async ({ page }) => {
  await toggle(page, A2);
  await analyze(page);
  await expect(banner(page).getByText('Policies: satisfied in model')).toBeVisible();
  await toggle(page, A2);
  await toggle(page, A3);
  await analyze(page);
  await expect(banner(page).getByText('Policies: satisfied in model')).toBeVisible();

  await toggle(page, A2);
  await analyze(page);
  await expect(banner(page).getByText('Policies: violated')).toBeVisible();
  await expect(banner(page).getByText('Goals: failed')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Policy violations and business-goal failures are different' })).toBeVisible();
  const goalFailures = page.getByRole('region', { name: 'Business-goal failures', exact: true });
  await expect(goalFailures).toContainText('What this means:');
  await expect(goalFailures).toContainText('Technical event:');
  await expect(goalFailures).toContainText('should stop the case for beneficiary verification failed');
  await expect(goalFailures).toContainText('kind=wrong_terminal; required=held:beneficiary_verification_failed; actual=reconciled');
  await expect(goalFailures).toContainText('Typed outcome:');

  const finding = page.locator('button.finding__btn', { hasText: 'P01|unverified-destination|CASE-NEW-VALID' });
  await expect(finding).toContainText('What this means:');
  await expect(finding).toContainText('Technical event:');
  await expect(finding).toContainText('valid, currently applicable independent verification');
  await finding.click();
  const steps = page.getByRole('table', { name: 'Witness steps' });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole('row')).not.toHaveCount(1);
  await expect(steps).toContainText('W10');
  await expect(steps).toContainText('Violation');
  // keyboard accessible: step buttons are real buttons
  await steps.getByRole('button', { name: /^Select step 1:/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Source metadata|Witness|Step/ }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Replay witness', exact: true }).click();
  await expect(page.getByText(/Witness verified: every step enabled; P01 violation confirmed/)).toBeVisible();

  await page.getByRole('tab', { name: 'Composition' }).click();
  await page.getByRole('button', { name: 'Run composition', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Minimal enabling set: {A2, A3}').first()).toBeVisible();
  await expect(panel.getByRole('row', { name: /A1 \+ A2 \+ A3/ })).toContainText('violated');
});

test('C2 is selected by synthesis, repairs the design, and economic sensitivity changes the preferred repair', async ({ page }) => {
  for (const n of [A1, A2, A3]) await toggle(page, n);
  await analyze(page);
  await expect(banner(page).getByText('Policies: violated')).toBeVisible();

  await page.getByRole('tab', { name: 'Repairs' }).click();
  await page.getByRole('button', { name: 'Run synthesis', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Optimization: optimal in catalog')).toBeVisible();
  const best = panel.getByRole('row').filter({ hasText: 'Best verified candidate' });
  await expect(best).toContainText('applied: C2');
  await expect(best).toContainText('USD 8,360.00');
  await expect(panel.getByRole('row').filter({ hasText: 'Ineligible' })).toContainText('USD 8,800.00');

  await best.getByRole('button', { name: 'Apply repair' }).click();
  await expect(banner(page).getByText('Policies: satisfied in model')).toBeVisible();
  await expect(banner(page).getByText('Goals: satisfied')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeEnabled();

  // economic edits invalidate the ranking but never the policy verdict
  await page.getByRole('tab', { name: 'Repairs' }).click();
  await page.getByRole('button', { name: 'Run synthesis', exact: true }).click();
  await expect(panel.getByText('Optimization: optimal in catalog')).toBeVisible();
  await page.getByLabel('Paid supplier events').fill('100');
  await expect(panel.getByText(/Optimization:/)).toHaveCount(0);
  await expect(banner(page).getByText('Policies: satisfied in model')).toBeVisible();
});

test('C1 beats C2 at 100 paid supplier events with a 16-hour budget', async ({ page }) => {
  for (const n of [A1, A2, A3]) await toggle(page, n);
  await page.getByLabel('Paid supplier events').fill('100');
  await page.getByRole('tab', { name: 'Repairs' }).click();
  await page.getByRole('button', { name: 'Run synthesis', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Optimization: optimal in catalog')).toBeVisible();
  await expect(panel.getByRole('row').filter({ hasText: 'Best verified candidate' })).toContainText('applied: C1');
});

test('an economics edit during a running repair search never leaves a hanging or stale run', async ({ page }) => {
  for (const n of [A1, A2, A3]) await toggle(page, n);
  await page.getByLabel('Case suite').selectOption('assurance-boundaries');
  await page.getByRole('tab', { name: 'Repairs' }).click();
  await page.getByLabel('Repair search mode').selectOption('maximum_value');
  await page.getByRole('button', { name: 'Run synthesis', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await page.getByLabel('Monthly invoices').fill('900');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeEnabled();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('tabpanel').getByText(/Optimization:/)).toHaveCount(0);
});
