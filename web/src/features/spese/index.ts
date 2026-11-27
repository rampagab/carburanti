// Scheda Spese (stile Splitwise, pensata per i viaggi).
// Tutto resta sul telefono; per condividere con gli amici si manda un link che contiene il viaggio.
import { askPayment, importGroup, shareGroup } from "./share";
import { getGroups, openGroup, saveGroups, setGroups, ui } from "./state";
import { renderSpese } from "./view";
import { num, personName, settle, uid, eur, type TripGroup } from "../../core";

export { renderSpese, importGroup };
export { getGroups } from "./state";

/** Aggiunge un viaggio creato altrove (es. dal pianificatore) e lo apre. */
export function addGroup(g: TripGroup): void {
  getGroups().unshift(g);
  saveGroups();
  ui.open = g.id;
  ui.adding = false;
  ui.pending = null;
}

/** Apre un viaggio già salvato (la vista si aggiorna all'ingresso nella scheda). */
export function showGroup(id: string): void {
  ui.open = id;
}

function speseClick(t: Element): boolean {
  if (t.closest("[data-sp-create]")) { ui.creating = true; renderSpese(); return true; }
  if (t.closest("[data-sp-nocreate]")) { ui.creating = false; renderSpese(); return true; }
  if (t.closest("[data-sp-cancel]")) { ui.pending = null; renderSpese(); return true; }
  const open = t.closest<HTMLElement>("[data-sp-open]");
  if (open) { ui.open = open.dataset.spOpen ?? null; ui.msg = ""; renderSpese(); window.scrollTo(0, 0); return true; }
  if (t.closest("[data-sp-back]")) { ui.open = null; ui.adding = false; ui.msg = ""; renderSpese(); return true; }
  const g = openGroup();
  if (!g) return false;
  if (t.closest("[data-sp-add]")) {
    ui.adding = true;
    renderSpese();
    document.querySelector<HTMLInputElement>("#sp-exp [name=desc]")?.focus();
    return true;
  }
  if (t.closest("[data-sp-noadd]")) { ui.adding = false; ui.pending = null; renderSpese(); return true; }
  if (t.closest("[data-sp-share]")) { shareGroup(g); return true; }
  if (t.closest("[data-sp-person]")) {
    const n = (window.prompt("Nome") || "").trim().slice(0, 30);
    if (n) { g.people.push({ id: uid("p"), name: n }); saveGroups(); renderSpese(); }
    return true;
  }
  if (t.closest("[data-sp-remove]")) {
    if (window.confirm(`Eliminare «${g.name}» e tutte le sue spese?`)) {
      setGroups(getGroups().filter((x) => x !== g));
      saveGroups();
      ui.open = null;
      renderSpese();
    }
    return true;
  }
  const ask = t.closest<HTMLElement>("[data-sp-ask]");
  if (ask) { askPayment(g, settle(g)[+ask.dataset.spAsk!]); return true; }
  const st = t.closest<HTMLElement>("[data-sp-settle]");
  if (st) {
    const x = settle(g)[+st.dataset.spSettle!];
    if (x && window.confirm(`${personName(g, x.from)} ha dato ${eur(x.cents)} a ${personName(g, x.to)}?`)) {
      // Come in Splitwise: un pagamento è una "spesa" pagata dal debitore e tutta a carico del creditore.
      g.expenses.push({ id: uid("e"), kind: "pay", desc: `${personName(g, x.from)} ha pagato ${personName(g, x.to)}`, amount: x.cents / 100, payer: x.from, split: [x.to], date: new Date().toISOString() });
      saveGroups();
      renderSpese();
    }
    return true;
  }
  const del = t.closest<HTMLElement>("[data-sp-del]");
  if (del) { g.expenses = g.expenses.filter((e) => e.id !== del.dataset.spDel); saveGroups(); renderSpese(); return true; }
  return false;
}

// I campi si leggono per nome: form.name sarebbe il nome del modulo, non il campo «name».
const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;

function speseSubmit(form: HTMLFormElement): void {
  const err = form.querySelector<HTMLElement>(".form-err")!;
  const fail = (m: string) => { err.hidden = false; err.textContent = m; };
  if (form.id === "sp-new") {
    const name = field(form, "name").value.trim();
    const people = [...new Set(field(form, "people").value.split(/[,;\n]/).map((x) => x.trim().slice(0, 30)).filter(Boolean))];
    if (!name) return fail("Scrivi un nome.");
    if (people.length < 2) return fail("Servono almeno 2 persone.");
    const g: TripGroup = { id: uid("g"), name: name.slice(0, 40), people: people.map((n) => ({ id: uid("p"), name: n })), expenses: [] };
    getGroups().unshift(g);
    saveGroups();
    ui.creating = false;
    ui.open = g.id;
    renderSpese();
    window.scrollTo(0, 0);
    return;
  }
  if (form.id === "sp-exp") {
    const g = openGroup()!;
    const amount = Math.round(num(field(form, "amount").value) * 100) / 100;
    const split = [...form.querySelectorAll<HTMLInputElement>("[name=split]")].filter((c) => c.checked).map((c) => c.value);
    const desc = field(form, "desc").value.trim();
    if (!desc) return fail("Scrivi cosa avete pagato.");
    if (!(amount > 0 && amount < 1e6)) return fail("Importo non valido.");
    if (!split.length) return fail("Scegli almeno una persona.");
    g.expenses.push({ id: uid("e"), desc: desc.slice(0, 60), amount, payer: field(form, "payer").value, split, date: new Date().toISOString() });
    saveGroups();
    ui.adding = false;
    ui.pending = null;
    renderSpese();
  }
}

/** Collega gli eventi della scheda. Da chiamare una volta, all'avvio. */
export function mountSpese(root: HTMLElement | null = document.querySelector("#view-spese")): void {
  if (!root) return;
  root.addEventListener("click", (e) => {
    // Gestito qui: non arriva al gestore generale dell'app (come prima, quando faceva «return»).
    if (e.target instanceof Element && speseClick(e.target)) e.stopPropagation();
  });
  root.addEventListener("submit", (e) => {
    const f = e.target as HTMLFormElement;
    if (f.id === "sp-new" || f.id === "sp-exp") { e.preventDefault(); speseSubmit(f); }
  });
}
