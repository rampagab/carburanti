import { expect, test, type Page } from "@playwright/test";

// Rete di sicurezza per la migrazione: i flussi principali devono restare identici.

async function open(page: Page, hash = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.goto("./?demo=1" + hash);
  return errors;
}

test("Prezzi: lista, consigliato e pillole", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("article.st").first()).toBeVisible();
  await expect(page.locator("#summary")).toContainText("Consigliato");
  await expect(page.locator("#pill-car")).toBeVisible();
  // prezzi con 3 decimali
  await expect(page.locator("article.st").first()).toContainText(/\d,\d{3}/);
  expect(errors).toEqual([]);
});

test("Menu: tutte le schede si aprono", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("article.st").first()).toBeVisible();
  for (const tab of ["viaggio", "spese", "auto", "altro", "prezzi"]) {
    await page.click(`.tabbar [data-tab=${tab}]`);
    await expect(page.locator(`#view-${tab}`)).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("Viaggio → Spese: calcolo, gruppo e pareggio", async ({ page }) => {
  const errors = await open(page, "#viaggio");
  await page.waitForSelector("#trip-form");
  await page.locator("[data-pf-input=to]").pressSequentially("vero", { delay: 30 });
  await page.click('[data-pf-pick="to:0"]');
  for (const n of ["Anna", "Luca"]) {
    await page.fill("#trip-form [name=pname]", n);
    await page.press("#trip-form [name=pname]", "Enter");
  }
  await page.click("#trip-form button[type=submit]");
  await expect(page.locator(".trip-res")).toBeVisible();
  await expect(page.locator("#along")).toBeVisible();

  await page.click("[data-trip-group]");
  await expect(page.locator(".view-title")).toBeVisible();
  const righe = page.locator(".bal.settle li");
  await expect(righe).toHaveCount(2);
  await page.click('[data-sp-settle="0"]');
  await expect(righe).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Garage: la scheda si apre", async ({ page }) => {
  const errors = await open(page, "#auto");
  await expect(page.locator("#view-auto")).toBeVisible();
  expect(errors).toEqual([]);
});
