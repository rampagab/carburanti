// Vista della scheda Spese: elenco dei viaggi e dettaglio di un viaggio.
import { balances, esc, eur, groupTotal, personName, settle, type TripGroup } from "../../core";
import { getGroups, openGroup, ui } from "./state";

export function renderSpese(): void {
  const el = document.querySelector("#view-spese");
  if (el) el.innerHTML = speseHTML();
}

function speseHTML(): string {
  const g = openGroup();
  if (g) return groupHTML(g);
  const groups = getGroups();
  const pending = ui.pending
    ? `<div class="notice">Scegli il viaggio per aggiungere <strong>${eur(Math.round(ui.pending.amount * 100))}</strong>. <button class="linkish" data-sp-cancel>Annulla</button></div>`
    : "";
  const form = ui.creating || !groups.length ? `<form id="sp-new" class="card form pad" autocomplete="off">
        <label class="field"><span>Nome del viaggio</span><input name="name" maxlength="40" required placeholder="Es. Weekend a Verona"></label>
        <label class="field"><span>Chi c'è (separati da virgola)</span><input name="people" required placeholder="Io, Marco, Giulia"></label>
        <p class="form-err" role="alert" hidden></p>
        <div class="preset-row"><button class="btn primary" type="submit">Crea</button>${groups.length ? '<button class="btn" type="button" data-sp-nocreate>Annulla</button>' : ""}</div>
      </form>` : "";
  return `${pending}
      ${groups.length ? `<ul class="glist">${groups.map((x) => `<li><button class="card gitem" data-sp-open="${esc(x.id)}">
        <strong>${esc(x.name)}</strong><span class="muted small">${x.people.length} persone · ${x.expenses.length} spese</span>
        <span class="gtot">${eur(groupTotal(x))}</span></button></li>`).join("")}</ul>` : ""}
      ${form}
      ${groups.length && !ui.creating ? '<button class="btn primary wide" data-sp-create>+ Nuovo viaggio</button>' : ""}`;
}

function groupHTML(g: TripGroup): string {
  const b = balances(g);
  const plan = settle(g);
  const total = groupTotal(g);
  const exp = g.expenses.slice().sort((a, c) => (c.date || "").localeCompare(a.date || ""));
  const pre: Partial<NonNullable<typeof ui.pending>> = ui.pending || {};
  const addForm = ui.adding || ui.pending ? `<form id="sp-exp" class="card form pad" autocomplete="off">
        <label class="field"><span>Cosa</span><input name="desc" maxlength="60" required value="${esc(pre.desc || "")}" placeholder="Es. Benzina, pedaggio, pranzo"></label>
        <label class="field"><span>Importo (€)</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${pre.amount ? (Math.round(pre.amount * 100) / 100).toFixed(2) : ""}"></label>
        <label class="field"><span>Ha pagato</span><select name="payer">${g.people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
        <fieldset class="box"><legend>Diviso tra</legend><div class="checks">${g.people.map((p) => `<label class="check"><input type="checkbox" name="split" value="${esc(p.id)}" checked> ${esc(p.name)}</label>`).join("")}</div></fieldset>
        <p class="form-err" role="alert" hidden></p>
        <div class="preset-row"><button class="btn primary" type="submit">Aggiungi</button><button class="btn" type="button" data-sp-noadd>Annulla</button></div>
      </form>` : `<button class="btn primary wide" data-sp-add>+ Spesa</button>`;
  return `<button class="back" data-sp-back>‹ Viaggi</button>
      <h2 class="view-title">${esc(g.name)}</h2>
      <p class="muted">Totale ${eur(total)} · ${g.people.length} persone</p>
      ${addForm}
      <section class="group">
        <h3>Saldi</h3>
        <ul class="bal">${g.people.map((p) => { const v = b[p.id] || 0; return `<li><span>${esc(p.name)}</span><strong class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v > 0 ? "+" : v < 0 ? "−" : ""}${eur(Math.abs(v))}</strong></li>`; }).join("")}</ul>
      </section>
      <section class="group">
        <h3>Per pareggiare</h3>
        ${plan.length ? `<ul class="bal settle">${plan.map((x, i) => `<li><span class="who">${esc(personName(g, x.from))} → ${esc(personName(g, x.to))}</span><strong>${eur(x.cents)}</strong>
          <span class="acts"><button class="btn sm" data-sp-ask="${i}">Chiedi</button><button class="btn sm primary" data-sp-settle="${i}">Saldato</button></span></li>`).join("")}</ul>` : `<p class="muted">Siete pari.</p>`}
        ${g.pay ? `<p class="muted small pay-info">Pagamenti a ${esc(personName(g, g.pay.to))}: ${g.pay.paypal ? `PayPal ${esc(g.pay.paypal)}` : ""}${g.pay.paypal && g.pay.iban ? " · " : ""}${g.pay.iban ? `IBAN ${esc(g.pay.iban)}` : ""}</p>` : ""}
      </section>
      <section class="group">
        <h3>Spese</h3>
        ${exp.length ? `<ul class="places">${exp.map((e) => `<li${e.kind === "pay" ? ' class="paid"' : ""}><span class="pl-name exp"><strong>${esc(e.desc)}</strong>
          <span class="muted small">${e.kind === "pay" ? "pagamento" : `${esc(personName(g, e.payer))} · ${e.split.length === g.people.length ? "tutti" : e.split.map((id) => esc(personName(g, id))).join(", ")}`}</span></span>
          <strong class="amt">${eur(Math.round(e.amount * 100))}</strong>
          <button class="icon-btn" data-sp-del="${esc(e.id)}" aria-label="Elimina ${esc(e.desc)}">✕</button></li>`).join("")}</ul>` : `<p class="muted">Ancora nessuna spesa.</p>`}
      </section>
      ${ui.msg ? `<p class="muted small" role="status">${esc(ui.msg)}</p>` : ""}
      <div class="preset-row">
        <button class="btn" data-sp-share>Condividi</button>
        <button class="btn" data-sp-person>+ Persona</button>
        <button class="btn danger" data-sp-remove>Elimina</button>
      </div>`;
}
