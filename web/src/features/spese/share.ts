// Condivisione: «Chiedi», «Condividi» e import da link.
import { askMessage, packGroup, shareSummary, uid, unpackGroup, type Transfer, type TripGroup } from "../../core";
import { getGroups, saveGroups, ui } from "./state";
import { renderSpese } from "./view";

/** Messaggio per chiedere i soldi: condivisione del sistema, altrimenti appunti, altrimenti da copiare. */
export function askPayment(g: TripGroup, x: Transfer | undefined): void {
  if (!x) return;
  const text = askMessage(g, x);
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { ui.msg = "Messaggio copiato: incollalo in chat."; renderSpese(); }, () => window.prompt("Copia il messaggio", text));
  else window.prompt("Copia il messaggio", text);
}

export function shareGroup(g: TripGroup): void {
  const link = location.origin + location.pathname + "#spese/import/" + packGroup(g);
  const text = shareSummary(g);
  if (navigator.share) {
    navigator.share({ title: g.name, text, url: link }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text + " " + link).then(() => { ui.msg = "Riepilogo e link copiati."; renderSpese(); }, () => {});
  } else window.prompt("Copia il link", link);
}

/** Importa (o aggiorna) un viaggio ricevuto con un link #spese/import/<dati>, dopo conferma. */
export function importGroup(data: string): void {
  let g: TripGroup;
  try { g = unpackGroup(data, () => uid("g")); } catch { window.alert("Link del viaggio non valido."); return; }
  const groups = getGroups();
  const i = groups.findIndex((x) => x.id === g.id);
  const ok = window.confirm(i >= 0 ? `Aggiornare «${g.name}» con i dati ricevuti?` : `Aggiungere il viaggio «${g.name}» (${g.people.length} persone, ${g.expenses.length} spese)?`);
  if (!ok) return;
  if (i >= 0) { if (groups[i]!.me) g.me = groups[i]!.me; groups[i] = g; } else groups.unshift(g);
  saveGroups();
  ui.open = g.id;
}
