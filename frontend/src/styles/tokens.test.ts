/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CHART } from "../lib/chartTheme";

// Stage 1 design-system guard: raw values live only in tokens.css (and the chart mirror).
const SRC = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
const all = files(SRC);
const css = all.filter(f => f.endsWith(".css") && !f.endsWith(join("styles", "tokens.css")));
const code = all.filter(f => /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f) && !f.endsWith("chartTheme.ts") && !f.endsWith("vite-env.d.ts"));
const tokens = readFileSync(join(SRC, "styles", "tokens.css"), "utf8");
const declarations = (text: string) =>
  [...text.matchAll(/(?<=[{;\s])(-{0,2}[a-zA-Z][\w-]*)\s*:([^;{}]*)/g)].map(m => ({ prop: m[1].toLowerCase(), value: m[2].trim() }));

describe("design tokens", () => {
  it("defines every font-size token at 14px or more", () => {
    const sizes = [...tokens.matchAll(/--text-[\w-]+:\s*(\d+)px/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(4);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
  });

  it("keeps raw colours, font sizes and spacing out of every other stylesheet", () => {
    const problems: string[] = [];
    for (const file of css) {
      const name = relative(SRC, file);
      for (const { prop, value } of declarations(readFileSync(file, "utf8"))) {
        if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value)) problems.push(`${name}: ${prop}: ${value}`);
        if (prop !== "white-space" && /^(white|black)$/i.test(value)) problems.push(`${name}: ${prop}: ${value}`);
        if (prop === "font-size" && !/^(var\(--text-[\w-]+\)|inherit|1em|100%|0)(\s*!important)?$/.test(value)) problems.push(`${name}: font-size: ${value}`);
        if (/^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(prop) && /\d+px/.test(value.replace(/var\([^)]*\)/g, ""))) problems.push(`${name}: ${prop}: ${value}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps colour literals and tiny inline font sizes out of components", () => {
    const problems: string[] = [];
    for (const file of code) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/["'`]#[0-9a-fA-F]{3,8}["'`]/g)) problems.push(`${relative(SRC, file)}: ${m[0]}`);
      for (const m of text.matchAll(/fontSize\s*[:=]\s*\{?\s*(\d+)/g)) if (Number(m[1]) < 14) problems.push(`${relative(SRC, file)}: fontSize ${m[1]}`);
    }
    expect(problems).toEqual([]);
  });

  it("chart colours mirror the CSS tokens", () => {
    const token = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
    expect(CHART.series.map(c => c.toLowerCase())).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(i => token(`chart-${i}`)));
    expect(CHART.primary.toLowerCase()).toBe(token("brand-600"));
    expect(CHART.primarySoft.toLowerCase()).toBe(token("brand-300"));
    expect(CHART.grid.toLowerCase()).toBe(token("neutral-100"));
    expect(CHART.muted.toLowerCase()).toBe(token("neutral-300"));
    expect(CHART.surface.toLowerCase()).toBe(token("neutral-0"));
    expect(CHART.fontSize).toBeGreaterThanOrEqual(14);
  });
});
