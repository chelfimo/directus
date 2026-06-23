// Import of required libraries
import { test, expect, getValue, newSkyrampPlaywrightPage } from '@skyramp/skyramp';

const BASE = 'http://localhost:8055';
const pageTimeout = 30000;
const stateTimeout = 30000;

// Directus persists search/filter server-side in the per-collection preset (shared across the
// /users status sub-views). Clear it so the "before any search -> idle" assertion is independent
// of prior tests / runs sharing the same SUT.
async function clearUsersPreset(rawPage: any, token: string) {
    const res = await rawPage.request.get(`${BASE}/presets`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { 'filter[collection][_eq]': 'directus_users', limit: -1, fields: 'id' },
    });
    const body = await res.json();
    const ids = (body.data || []).map((p: any) => p.id);
    for (const id of ids) {
        await rawPage.request.patch(`${BASE}/presets/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { search: null, filter: null },
        });
    }
}

test.use({
    viewport: { width: 1280, height: 900 },
});

test('testUi', async ({ page }) => {
    test.setTimeout(262000);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    page.setDefaultTimeout(pageTimeout);
    // Assertions/waits run on the raw page (real Playwright locator.waitFor polls correctly);
    // actions run on the wrapped page for trace capture.
    const rawPage = page;
    page = newSkyrampPlaywrightPage(page);

    await page.goto(`${BASE}/admin/login`);

    const playwrightRequest0: Record<string, any> = {
        "email": "admin@example.com",
        "password": "password"
    };

    await page.getByRole("textbox", { name: "Email" }).fill(getValue(playwrightRequest0, "email"));
    await page.getByRole("textbox", { name: "Password" }).fill(getValue(playwrightRequest0, "password"));
    // Let the login form hydrate before submitting, else the click fires before Vue wires its handler.
    await page.waitForTimeout(1500);
    const responsePromise0 = page.waitForResponse("**/auth/login**");
    await page.getByRole("button", { name: "Sign In" }).click();
    const response0 = await responsePromise0;
    expect(response0.status()).toBe(200);

    const token = (await response0.json()).data.access_token;
    await clearUsersPreset(rawPage, token);

    await page.goto(`${BASE}/admin/users`);

    // Assert state by polling an attribute-selector via locator.waitFor. Targeting `.layout-tabular`
    // (always present) also handles the no-<table> empty case.

    // UC04-S1: before any search the list region is idle.
    await rawPage.locator('.layout-tabular[data-state="idle"]').waitFor({ state: 'attached', timeout: stateTimeout });

    await page.getByRole("button", { name: "search" }).click();
    await page.getByRole("searchbox", { name: "Search Items..." }).fill("admin");

    // UC04-S3: a matching search yields data-state="results".
    await rawPage.locator('.layout-tabular[data-state="results"]').waitFor({ state: 'attached', timeout: stateTimeout });
    await rawPage.getByRole("cell", { name: "admin@example.com" }).waitFor({ state: 'visible', timeout: stateTimeout });

    await page.getByRole("searchbox", { name: "Search Items..." }).fill("");

    // UC04-C3: clearing the input returns the region to idle.
    await rawPage.locator('.layout-tabular[data-state="idle"]').waitFor({ state: 'attached', timeout: stateTimeout });

    expect(pageErrors).toHaveLength(0);
});
