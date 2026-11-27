// Stato della scheda Spese: i viaggi salvati sul telefono e lo stato della vista.
import type { TripGroup } from "../../core";
import { store } from "../../data/storage";

function load(): TripGroup[] {
  const g = store.get<unknown>("groups", []);
  return Array.isArray(g) ? (g as TripGroup[]) : [];
}

let groups: TripGroup[] = load();

/** Spesa proposta da un'altra scheda, in attesa di scegliere il viaggio. */
export interface PendingExpense {
  desc?: string;
  amount: number;
}

export const ui = {
  /** id del viaggio aperto */
  open: null as string | null,
  creating: false,
  adding: false,
  pending: null as PendingExpense | null,
  msg: "",
};

export const getGroups = (): TripGroup[] => groups;
export const setGroups = (list: TripGroup[]): void => {
  groups = list;
};
export const saveGroups = (): void => store.set("groups", groups);
export const openGroup = (): TripGroup | undefined => groups.find((x) => x.id === ui.open);
