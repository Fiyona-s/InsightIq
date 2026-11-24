import { CHART } from "../lib/chartTheme";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_READINGS, chartInsights } from "../lib/automlMeaning";
import type { MLResult } from "../automlapi";
import { numericAxis } from "../lib/chartAxis";
import { formatNumber } from "../lib/formatters";
function axis(values: (number | null | undefined)[], zero = false) {
  const a = numericAxis(values.filter((v): v is number => typeof v === "number"), zero);
  return {domain:a.domain,ticks:a.ticks,tickCount:a.tickCount,tickFormatter:a.formatter};
}
const tooltip = (v: unknown) => typeof v === "number" ? formatNumber(v) : String(v);
const colors = [
  CHART.primary,
  CHART.series[5],
  CHART.series[3],
  CHART.series[2],
  CHART.series[4],
  CHART.series[1],
  CHART.series[6],
  CHART.series[7],
];
function Canvas({
  title,
  reading,
  insight,
  children,
}: {
  title: string;
  reading?: string;
  insight?: string;
  children: React.ReactElement;
}) {
  return (
    <section className="ml-plot">
      <h3>{title}</h3>
      <div role="img" aria-label={title} className="ml-chart-canvas">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {children}
        </ResponsiveContainer>
      </div>
      {reading && <p className="ml-plot-reading"><strong>How to read this:</strong> {reading}</p>}
      {insight && <p className="ml-plot-reading ml-plot-insight">{insight}</p>}
    </section>
  );
}
export default function AutoMLPlots({ result }: { result: MLResult }) {
  const p = result.plots;
  const insights = chartInsights(result);
  return (
    <div className="ml-plots">
      {!!p.regression?.length && (
        <>
          <Canvas title="Actual vs predicted — held-out test rows" reading={CHART_READINGS.actualVsPredicted} insight={insights.actualVsPredicted}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="actual"
                name="Actual"
                {...axis(p.regression.map(v => v.actual))}
              />
              <YAxis
                type="number"
                dataKey="predicted"
                name="Predicted"
                width={70}
                {...axis(p.regression.map(v => v.predicted))}
              />
              <Tooltip formatter={tooltip} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter
                data={p.regression}
                fill={CHART.primary}
                name="Test predictions"
              />
            </ScatterChart>
          </Canvas>
          <Canvas title="Residuals — actual minus predicted" reading={CHART_READINGS.residuals} insight={insights.residuals}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="predicted"
                name="Predicted"
                {...axis(p.regression.map(v => v.predicted))}
              />
              <YAxis
                type="number"
                dataKey="residual"
                name="Residual"
                width={70}
                {...axis(p.regression.map(v => v.residual))}
              />
              <ReferenceLine y={0} stroke={CHART.muted} />
              <Tooltip formatter={tooltip} />
              <Scatter data={p.regression} fill={CHART.series[2]} />
            </ScatterChart>
          </Canvas>
        </>
      )}
      {!!p.classification?.length && (
        <Canvas title="Held-out actual and predicted class counts" reading={CHART_READINGS.classCounts} insight={insights.classCounts}>
          <BarChart data={p.classification}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="class" />
            <YAxis allowDecimals={false} {...axis(p.classification.flatMap(v=>[v.actual,v.predicted]), true)} />
            <Tooltip formatter={tooltip} />
            <Legend />
            <Bar dataKey="actual" name="Actual" fill={CHART.primary} />
            <Bar dataKey="predicted" name="Predicted" fill={CHART.primarySoft} />
          </BarChart>
        </Canvas>
      )}
      {p.clusters && (
        <Canvas title="Customer / row segments — PCA projection" reading={CHART_READINGS.clusters} insight={insights.clusters}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              type="number"
              name="PCA component 1"
              {...axis(p.clusters.map(v => v.x))}
            />
            <YAxis
              dataKey="y"
              type="number"
              name="PCA component 2"
              width={70}
              {...axis(p.clusters.map(v => v.y))}
            />
            <Tooltip formatter={tooltip} />
            <Legend />
            {[...new Set(p.clusters.map((point) => point.cluster))]
              .sort()
              .map((cluster) => (
                <Scatter
                  key={cluster}
                  name={"Cluster " + cluster}
                  data={p.clusters!.filter(
                    (point) => point.cluster === cluster,
                  )}
                  fill={colors[cluster % colors.length]}
                />
              ))}
          </ScatterChart>
        </Canvas>
      )}
      {p.anomaly_distribution && (
        <Canvas title="Anomaly score distribution — all fitted rows" reading={CHART_READINGS.anomalyScores} insight={insights.anomalyScores}>
          <BarChart
            data={p.anomaly_distribution.map((b) => ({
              ...b,
              label: (b.lower + b.upper) / 2,
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" type="number" name="Score bin midpoint" {...axis(p.anomaly_distribution.map(b=>(b.lower+b.upper)/2))} />
            <YAxis allowDecimals={false} {...axis(p.anomaly_distribution.flatMap(v=>[v.count,v.flagged]), true)} />
            <Tooltip formatter={tooltip} />
            <Legend />
            <Bar dataKey="count" name="All rows in bin" fill={CHART.series[5]} />
            <Bar dataKey="flagged" name="Flagged subset" fill={CHART.series[1]} />
          </BarChart>
        </Canvas>
      )}
      {p.forecast && (
        <Canvas title="Historical measure and future point forecast" reading={CHART_READINGS.forecast} insight={insights.forecast}>
          <LineChart data={p.forecast}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={35} />
            <YAxis {...axis(p.forecast.flatMap(v=>[v.actual,v.forecast]), true)} width={70} />
            <Tooltip formatter={tooltip} />
            <Legend />
            <Line
              dataKey="actual"
              name="Historical observed / explicitly filled"
              stroke={CHART.primary}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="forecast"
              name="Future point forecast"
              stroke={CHART.series[3]}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </Canvas>
      )}
      {p.backtest && (
        <Canvas title="Untouched final chronological test" reading={CHART_READINGS.finalWindow} insight={insights.finalWindow}>
          <LineChart data={p.backtest}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis {...axis(p.backtest.flatMap(v=>[v.actual,v.predicted]), true)} width={70} />
            <Tooltip formatter={tooltip} />
            <Legend />
            <Line
              dataKey="actual"
              stroke={CHART.primary}
              name="Actual"
              isAnimationActive={false}
            />
            <Line
              dataKey="predicted"
              stroke={CHART.series[3]}
              name="Predicted from earlier history"
              isAnimationActive={false}
            />
          </LineChart>
        </Canvas>
      )}
      {(result.feature_importance?.values?.length||0) > 0 && (
        <Canvas title="What mattered most to the model" reading={CHART_READINGS.importance} insight={insights.importance}>
          <BarChart
            data={result.feature_importance.values}
            layout="vertical"
            margin={{ left: 35 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" {...axis(result.feature_importance.values.map(v=>v.importance), true)} />
            <YAxis
              type="category"
              dataKey="feature"
              width={110}
              tick={{ fontSize: CHART.fontSize }}
              tickFormatter={(s) => String(s).replace(/^(numeric|categorical|datetime)__/, "").slice(0, 22)}
            />
            <Tooltip formatter={tooltip} />
            <Bar dataKey="importance" fill={CHART.primary} />
          </BarChart>
        </Canvas>
      )}
    </div>
  );
}
