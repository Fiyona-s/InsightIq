import { displayAmount, formatDisplayNumber } from "../lib/displayNumber";
import { CHART } from "../lib/chartTheme";
import {formatDate} from "../lib/formatters";
import { formatNumber } from "../lib/formatters";
import { displayMoney, useCurrency, multiply } from "../lib/currency";
import { numericAxis } from "../lib/chartAxis";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Cell,
  Pie,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ChartData } from "../api";
export default function ResultChart({
  data: original,
  displayId = "",
}: {
  data: ChartData;
  displayId?: string;
}) {
  const state = useCurrency(displayId);
  const quote = original.money?.currency
    ? state.quotes[original.money.currency]
    : undefined;
  const xQuote = original.x_money?.currency
    ? state.quotes[original.x_money.currency]
    : undefined;
  const yData = quote
    ? {
        ...original,
        points: original.points.map((p) => ({
          ...p,
          y: p.y == null ? p.y : Number(multiply(String(p.y), quote.rate)),
          value: multiply(String(p.value), quote.rate),
        })),
      }
    : original;
  const data = xQuote
    ? {
        ...yData,
        points: yData.points.map((p) => ({
          ...p,
          x: p.x == null ? p.x : Number(multiply(String(p.x), xQuote.rate)),
        })),
      }
    : yData;
  const formatted = (v: unknown) =>
    displayAmount(
      v,
      quote ? { currency: quote.target_currency } : original.money,
      { ...state, quotes: {} },
      undefined,
      original.percent === true,
    );
  const kind = data.spec.kind;
  const yAxis = numericAxis(
    data.points.map((p) => p.y!).filter((v) => v != null),
    kind === "bar" || kind === "line",
    {currency: quote?.target_currency || original.money?.currency || undefined},
  );
  const xAxis = numericAxis(data.points.map(p=>Number(p.x)).filter(Number.isFinite), false, {currency:xQuote?.target_currency || original.x_money?.currency || undefined});
  const yTick = original.percent === true ? (v: number) => yAxis.formatter(v) + "%" : yAxis.formatter;
  const yWidth = yAxis.width;
  if (
    data.points.some(
      (p) =>
        (p.y != null &&
          (!Number.isFinite(p.y) || Math.abs(p.y) > Number.MAX_SAFE_INTEGER)) ||
        (kind === "scatter" &&
          typeof p.x === "number" &&
          (!Number.isFinite(p.x) || Math.abs(p.x) > Number.MAX_SAFE_INTEGER)),
    )
  )
    return (
      <p>
        Converted values exceed safe chart precision. Inspect the exact values
        in the results table.
      </p>
    );
  if (kind === "table")
    return <p className="insight-note">Use the complete result table below.</p>;
  if (kind === "kpi")
    return (
      <div className="result-kpi">
        <span>
          {original.money?.currency && /^[a-z0-9_]+$/i.test(data.spec.title)
            ? data.spec.title
                .replace(/^total_/i, "")
                .replace(
                  new RegExp("_" + original.money.currency + "$", "i"),
                  "",
                )
                .split("_")
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ")
            : data.spec.title}
        </span>
        <strong title={`Original value: ${original.points[0]?.value}`}>
          {original.money?.currency || original.percent === true
            ? formatted(data.points[0]?.value)
            : formatDisplayNumber(data.points[0]?.value, state.locale)}
        </strong>
        <small>
          {quote ? "Converted display" : "Query result"}{" "}
          {quote?.target_currency || original.money?.currency}
        </small>
      </div>
    );
  return (
    <div
      className="chart-canvas"
      role="img"
      aria-label={
        data.spec.title +
        ", " +
        data.points.length +
        " result points. Exact values in the results table."
      }
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {kind === "bar" ? (
          <BarChart data={data.points} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis
              tickFormatter={yTick}
              width={yWidth}
              domain={yAxis.domain}
              ticks={yAxis.ticks}
              tickCount={yAxis.tickCount}
            />
            <Tooltip
              formatter={formatted}
            />
            <Bar
              dataKey="y"
              name={data.spec.title}
              fill={CHART.primary}
              radius={[5, 5, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        ) : kind === "line" ? (
          <LineChart data={data.points} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => formatDate(v, "date")}
            />
            <YAxis
              tickFormatter={yTick}
              width={yWidth}
              domain={yAxis.domain}
              ticks={yAxis.ticks}
              tickCount={yAxis.tickCount}
            />
            <Tooltip
              formatter={formatted}
              labelFormatter={(v) => formatDate(Number(v), "datetime")}
            />
            <Line
              dataKey="y"
              name={data.spec.title}
              type="linear"
              stroke={CHART.primary}
              strokeWidth={2.5}
              dot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        ) : kind === "donut" ? (
          <PieChart accessibilityLayer>
            <Pie
              data={data.points}
              dataKey="y"
              nameKey="label"
              innerRadius="55%"
              outerRadius="80%"
              fill={CHART.primary}
              label={({ name }) => name}
              isAnimationActive={false}
            >
              {data.points.map((point, index) => (
                <Cell
                  key={point.row}
                  fill={
                    [
                      CHART.primary,
                      CHART.series[5],
                      CHART.series[3],
                      CHART.series[2],
                      CHART.series[4],
                      CHART.series[1],
                      CHART.series[6],
                      CHART.series[7],
                    ][index % 8]
                  }
                />
              ))}
            </Pie>
            <Tooltip
              formatter={formatted}
            />
          </PieChart>
        ) : (
          <ScatterChart accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" domain={xAxis.domain} ticks={xAxis.ticks} tickCount={xAxis.tickCount} tickFormatter={xAxis.formatter} />
            <YAxis
              type="number"
              dataKey="y"
              domain={yAxis.domain} ticks={yAxis.ticks} tickCount={yAxis.tickCount}
              tickFormatter={yTick}
              width={yWidth}
            />
            <Tooltip
              formatter={(value, name) =>
                name === "x"
                  ? displayMoney(
                      value,
                      xQuote
                        ? { currency: xQuote.target_currency }
                        : original.x_money,
                      { ...state, quotes: {} },
                    )
                  : formatted(value)
              }
              cursor={{ strokeDasharray: "3 3" }}
            />
            <Scatter
              data={data.points}
              fill={CHART.primary}
              isAnimationActive={false}
            />
          </ScatterChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
