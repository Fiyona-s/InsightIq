import { compactUnit, formatAxisTick } from "./formatters";
/** Rounded display domains/ticks only; input series and original values stay unchanged. */
export function numericAxis(values: number[], includeZero = false, options: {currency?: string; tickCount?: number} = {}) {
  const finite = values.filter(Number.isFinite);
  const actualMin = finite.length ? Math.min(...finite) : 0;
  const actualMax = finite.length ? Math.max(...finite) : 0;
  const minimum = includeZero ? Math.min(0, actualMin) : actualMin;
  const maximum = includeZero ? Math.max(0, actualMax) : actualMax;
  const count = Math.max(2, Math.min(10, options.tickCount ?? 6));
  const round = (n: number) => Number(n.toPrecision(15));
  function nice(n: number) {
    const power = 10 ** Math.floor(Math.log10(n));
    return ( [1, 2, 2.5, 5, 10].find(v => v * power >= n * (1 - 1e-12)) ?? 10) * power;
  }
  let step = nice((maximum - minimum || Math.abs(maximum) * 0.1 || 1) / (count - 1));
  let low = 0, high = 1;
  let unit = compactUnit(Math.max(Math.abs(minimum), Math.abs(maximum)), options.currency);
  const divisors = {"":1,K:1e3,L:1e5,Cr:1e7,M:1e6,B:1e9};
  for (let pass = 0; pass < 5; pass++) {
    low = round(Math.floor(minimum / step) * step);
    high = round(Math.ceil(maximum / step) * step);
    if (high <= actualMax) high = round(high + step);
    if (high <= low) high = round(low + step);
    unit = compactUnit(Math.max(Math.abs(low), Math.abs(high)), options.currency);
    // One-decimal compact labels must distinguish narrow ranges at a large magnitude.
    const magnitude = Math.max(Math.abs(low), Math.abs(high));
    const quantum = unit ? divisors[unit] / 10 : magnitude >= 0.1 ? 0.1 : magnitude ? 10 ** Math.floor(Math.log10(magnitude)) / 10 : 0;
    if (step >= quantum) break;
    step = nice(quantum);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) {low=minimum; high=maximum;}
  const formatter = (value: number | string) => formatAxisTick(value, {currency:options.currency,unit});
  const ticks: number[] = [];
  for (let i = 0; i < 30; i++) {
    const value = round(low + i * step);
    if (value > high + step * 1e-9) break;
    if (!ticks.length || formatter(value) !== formatter(ticks[ticks.length-1])) ticks.push(value);
  }
  const width = Math.min(190, Math.max(60, ...ticks.map(v=>formatter(v).length * 7 + 16)));
  return {formatter, width, domain:[low,high] as [number,number], ticks, tickCount:ticks.length, step, unit};
}
