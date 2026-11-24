import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CURRENCY_KEY, readDefaultCurrency, setDefaultCurrency } from "./defaultCurrency";
import { api } from "../api";

beforeEach(() => localStorage.clear());
describe("default currency", () => {
  it("is USD unless the owner changes it", () => {
    expect(readDefaultCurrency()).toBe("USD");
    setDefaultCurrency("EUR"); expect(readDefaultCurrency()).toBe("EUR");
    setDefaultCurrency(null); expect(readDefaultCurrency()).toBeNull();
    localStorage.setItem(DEFAULT_CURRENCY_KEY, "ZZZ"); expect(readDefaultCurrency()).toBe("USD"); // unknown values never leak through
  });
  it("is never sent with an upload: the offered currency marks nothing by itself", async () => {
    const calls: FormData[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => { calls.push(init.body as FormData); return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } }); }) as never;
    try {
      await api.upload(new File(["a\n1\n"], "a.csv"));
      expect(calls[0].has("default_currency")).toBe(false);
    } finally { globalThis.fetch = real; }
  });
});
