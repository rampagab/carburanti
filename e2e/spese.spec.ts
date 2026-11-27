import { expect, test, type Page } from "@playwright/test";

// Scheda Spese: «Chiedi», import da link e flusso base. Dati preparati nel localStorage
// con le stesse chiavi dell'app (prefisso «carburanti:»).

const GROUP = {
  id: "gtest",
  name: "Weekend a Verona",
  people: [
    { id: "pa", name: "Anna" },
    { id: "pl", name: "Luca" },
  ],
  expenses: [{ id: "e1", desc: "Benzina", amount: 60, payer: "pa", split: ["pa", "pl"], date: "2026-11-01T10:00:00.000Z" }],
  pay: { to: "pa", paypal: "annarossi", iban: "IT60 X054 2811 1010 0000 0123 456", holder: "Anna Rossi" },
  me: "pa",
};

/** Come packGroup nell'app: JSON in UTF-8, base64 per URL senza «=». */
const pack = (g: object) => Buffer.from(JSON.stringify({ v: 1, ...g }), "utf8").toString("base64url");
const nb = (s: string) => s.replace(/[  ]/g, " ");

interface Opts { groups?: object[]; share?: "share" | "clipboard" }

async function open(page: Page, hash: string, opts: Opts = {}) {
  const errors: string[] = [];
  const dialogs: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await page.addInitScript(({ groups, share }) => {
    if (groups) localStorage.setItem("carburanti:groups", JSON.stringify(groups));
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    if (share === "share") {
      Object.defineProperty(navigator, "share", { configurable: true, value: async (d: unknown) => { w.__shared.push(d); } });
    } else if (share === "clipboard") {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { w.__shared.push(t); } } });
    }
  }, opts);
  await page.goto("./?demo=1" + hash);
  return { errors, dialogs };
}
const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared);
const savedGroups = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("carburanti:groups") || "null"));

test("Chiedi: messaggio con PayPal compilato e IBAN", async ({ page }) => {
  const { errors } = await open(page, "#spese", { groups: [GROUP], share: "share" });
  await page.click('[data-sp-open="gtest"]');
  await expect(page.locator(".view-title")).toHaveText("Weekend a Verona");
  await expect(page.locator(".bal.settle li")).toHaveCount(1);
  await expect(page.locator(".bal.settle li")).toContainText("Luca → Anna");
  await page.click('[data-sp-ask="0"]');
  await expect.poll(() => shared(page)).toHaveLength(1);
  const [d] = (await shared(page)) as { text: string }[];
  expect(nb(d!.text)).toBe(
    "Ciao Luca! Per «Weekend a Verona» la tua parte è 30,00 €.\n" +
      "PayPal: https://paypal.me/annarossi/30.00EUR\n" +
      "Bonifico: IT60 X054 2811 1010 0000 0123 456 (Anna Rossi), causale «Weekend a Verona»",
  );
  expect(errors).toEqual([]);
});

test("Chiedi: senza condivisione del sistema copia il messaggio", async ({ page }) => {
  const { errors } = await open(page, "#spese", { groups: [{ ...GROUP, pay: undefined }], share: "clipboard" });
  await page.click('[data-sp-open="gtest"]');
  await page.click('[data-sp-ask="0"]');
  await expect(page.locator("#view-spese [role=status]")).toHaveText("Messaggio copiato: incollalo in chat.");
  expect(nb(String((await shared(page))[0]))).toBe("Ciao Luca! Per «Weekend a Verona» la tua parte è 30,00 €.\nDa dare a Anna.");
  expect(errors).toEqual([]);
});

test("Import da link: aggiunge il viaggio e lo apre", async ({ page }) => {
  const { me: _me, ...shared } = GROUP;
  const { errors, dialogs } = await open(page, "#spese/import/" + pack(shared));
  await expect(page.locator(".view-title")).toHaveText("Weekend a Verona");
  expect(dialogs).toEqual(["Aggiungere il viaggio «Weekend a Verona» (2 persone, 1 spese)?"]);
  await expect(page).toHaveURL(/#spese$/);
  await expect(page.locator(".bal.settle li")).toContainText("Luca → Anna");
  await expect(page.locator(".pay-info")).toContainText("PayPal annarossi");
  const saved = await savedGroups(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: "gtest", name: "Weekend a Verona", people: GROUP.people });
  expect(errors).toEqual([]);
});

test("Import da link: aggiorna il viaggio esistente e tiene «io»", async ({ page }) => {
  const updated = { ...GROUP, me: undefined, expenses: [...GROUP.expenses, { id: "e2", desc: "Pranzo", amount: 40, payer: "pl", split: ["pa", "pl"], date: "2026-11-02T12:00:00.000Z" }] };
  const { errors, dialogs } = await open(page, "#spese/import/" + pack(updated), { groups: [GROUP] });
  await expect(page.locator(".view-title")).toHaveText("Weekend a Verona");
  expect(dialogs).toEqual(["Aggiornare «Weekend a Verona» con i dati ricevuti?"]);
  await expect(page.locator("#view-spese")).toContainText("Pranzo");
  const saved = await savedGroups(page);
  expect(saved).toHaveLength(1);
  expect(saved[0].expenses).toHaveLength(2);
  expect(saved[0].me).toBe("pa");
  expect(errors).toEqual([]);
});

test("Import da link: link rotto", async ({ page }) => {
  const { errors, dialogs } = await open(page, "#spese/import/non-valido!!");
  await expect(page.locator("#view-spese")).toBeVisible();
  expect(dialogs).toEqual(["Link del viaggio non valido."]);
  await expect(page).toHaveURL(/#spese$/);
  expect(await savedGroups(page)).toBeNull();
  expect(errors).toEqual([]);
});

test("Spese: crea viaggio, aggiungi spesa, elimina", async ({ page }) => {
  const { errors } = await open(page, "#spese");
  await page.fill("#sp-new [name=name]", "Mare");
  await page.fill("#sp-new [name=people]", "Io");
  await page.click("#sp-new button[type=submit]");
  await expect(page.locator("#sp-new .form-err")).toHaveText("Servono almeno 2 persone.");
  await page.fill("#sp-new [name=people]", "Io, Marco, Giulia");
  await page.click("#sp-new button[type=submit]");
  await expect(page.locator(".view-title")).toHaveText("Mare");
  await page.click("[data-sp-add]");
  await page.fill("#sp-exp [name=desc]", "Ombrellone");
  await page.fill("#sp-exp [name=amount]", "30");
  await page.click("#sp-exp button[type=submit]");
  await expect(page.locator(".bal.settle li")).toHaveCount(2);
  await expect(page.locator("#view-spese .view-title + .muted")).toContainText("Totale 30,00");
  await page.click("[data-sp-del]");
  await expect(page.locator("#view-spese")).toContainText("Ancora nessuna spesa.");
  await page.click("[data-sp-back]");
  await expect(page.locator(".gitem")).toHaveCount(1);
  expect((await savedGroups(page))[0].people).toHaveLength(3);
  expect(errors).toEqual([]);
});
