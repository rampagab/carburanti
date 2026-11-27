import { afterEach, describe, expect, it } from "vitest";
import { store } from "./storage";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
  removeItem(k: string) { this.data.delete(k); }
}

function useStorage(s: unknown) {
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("store", () => {
  it("usa il prefisso carburanti: e JSON", () => {
    const mem = new MemoryStorage();
    useStorage(mem);
    store.set("groups", [{ id: "g1" }]);
    expect(mem.data.get("carburanti:groups")).toBe('[{"id":"g1"}]');
    expect(store.get("groups", [])).toEqual([{ id: "g1" }]);
  });

  it("restituisce il valore di riserva se manca, è rotto o localStorage non c'è", () => {
    const mem = new MemoryStorage();
    useStorage(mem);
    expect(store.get("nulla", 7)).toBe(7);
    mem.setItem("carburanti:rotto", "{non json");
    expect(store.get("rotto", "ok")).toBe("ok");
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(store.get("groups", [])).toEqual([]);
    expect(() => store.set("groups", [])).not.toThrow();
  });

  it("clearCache toglie solo le chiavi di cache", () => {
    const mem = new MemoryStorage();
    mem.setItem("carburanti:cache:a", "1");
    mem.setItem("carburanti:groups", "[]");
    mem.setItem("altro", "x");
    // Object.keys(localStorage) deve vedere le chiavi
    const proxy = new Proxy(mem, { ownKeys: () => [...mem.data.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
    useStorage(proxy);
    store.clearCache();
    expect([...mem.data.keys()].sort()).toEqual(["altro", "carburanti:groups"]);
  });
});
