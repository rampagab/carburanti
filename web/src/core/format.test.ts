import { describe, expect, it } from "vitest";
import { esc, eur, num, uid } from "./format";

describe("format", () => {
  it("eur: centesimi in euro all'italiana", () => {
    expect(eur(1234).replace(/[\u00a0\u202f]/g, " ")).toBe("12,34 €");
    expect(eur(0).replace(/[\u00a0\u202f]/g, " ")).toBe("0,00 €");
    expect(eur(1234567).replace(/[\u00a0\u202f]/g, " ")).toBe("12.345,67 €");
  });
  it("num: accetta la virgola", () => {
    expect(num("12,5")).toBe(12.5);
    expect(num("3.2")).toBe(3.2);
    expect(num(null)).toBeNaN();
    expect(num("")).toBeNaN();
  });
  it("esc: niente HTML", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(esc(null)).toBe("");
  });
  it("uid: prefisso e unicità", () => {
    const ids = new Set(Array.from({ length: 200 }, () => uid("g")));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^g[0-9a-z]+$/);
  });
});
