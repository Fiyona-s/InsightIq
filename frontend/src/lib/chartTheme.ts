/**
 * Chart colours for SVG/canvas attributes, which cannot read CSS variables.
 * Values MUST mirror src/styles/tokens.css (checked by src/styles/tokens.test.ts).
 */
export const CHART = {
  primary: "#237a5d",   // --brand-600 / --chart-1
  primarySoft: "#8fc9ae", // --brand-300
  series: ["#237a5d", "#b0664a", "#3f7fa0", "#9a7a2e", "#7d64a0", "#6e8a3a", "#4f8a8f", "#8a8a3a"], // --chart-1..8
  grid: "#e3e8e5",      // --neutral-100
  muted: "#aebab3",     // --neutral-300
  surface: "#ffffff",   // --neutral-0
  /** Minimum readable size for axis and label text. */
  fontSize: 14,
} as const;
