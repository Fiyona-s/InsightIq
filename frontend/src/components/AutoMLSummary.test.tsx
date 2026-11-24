import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import AutoMLSummary from "./AutoMLSummary";
import { taskSuggestions, taskSupport } from "../lib/automlPresentation";
import type { MLExperiment, MLProfile } from "../automlapi";
afterEach(cleanup);
function fixture(r2: number, baseline = true): MLExperiment {
  return {
    task: "regression",
    duration_seconds: 2,
    configuration: { features: [{ name: "revenue_inr", kind: "numeric" }] },
    result: {
      leaderboard: [
        {
          algorithm: "Ridge",
          selected: true,
          status: "completed",
          validation_metrics: { mae: 2, r2 },
          test_metrics: { mae: 3, r2 },
        },
        ...(baseline
          ? [
              {
                algorithm: "DummyRegressor",
                selected: false,
                status: "completed",
                validation_metrics: { mae: 5, r2: -0.1 },
                test_metrics: null,
              },
            ]
          : []),
      ],
      selection_metric: "rmse",
      split: { test: { count: 20 } },
      plots: {},
      details: {},
      rows_used: 100,
      feature_importance: { values: [] },
    },
  } as unknown as MLExperiment;
}
it.each([0.8, 0.00001, 0, -0.5])(
  "uses measured R² %s without a quality badge or inferred units",
  (r2) => {
    render(<AutoMLSummary job={fixture(r2)} />);
    expect(screen.getByText(/On held-out data/)).toHaveTextContent("3");
    expect(
      screen.queryByText(/Good|Fair|Needs work|improvement|₹|\$|INR|USD/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/explains.*variation/)).not.toBeInTheDocument();
    expect(!!screen.queryByText(/Negative held-out R²/)).toBe(r2 < 0);
  },
);
it("compares validation to validation, never fills missing baseline test scores", () => {
  render(<AutoMLSummary job={fixture(0.7)} />);
  expect(
    screen.getByText(/Validation split \(not the final test\)/),
  ).toBeInTheDocument();
  expect(screen.getByText(/training mean/)).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent("5");
  expect(screen.getByRole("table")).not.toHaveTextContent("3");
});
it("claims no baseline or improvement when none is stored and explains omitted plots and importance", () => {
  render(<AutoMLSummary job={fixture(0.1, false)} />);
  expect(screen.getByText("Baseline not recorded.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(
    screen.getByText("Feature importance not recorded for this model."),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/actual vs predicted plot omitted/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/improvement|Good|Fair|Needs work/),
  ).not.toBeInTheDocument();
});
it("renders recorded classification metrics and importance method without inventing a plot", () => {
  const job = fixture(0.3, false);
  job.task = "classification";
  job.result!.leaderboard[0].test_metrics = { accuracy: 0.75, f1_macro: 0.7 };
  job.result!.selection_metric = "f1_macro";
  job.result!.feature_importance = {
    method: "Recorded coefficients",
    values: [{ feature: "x", importance: 1 }],
  };
  render(<AutoMLSummary job={job} />);
  expect(screen.getByText(/accuracy was 75.0%/)).toHaveTextContent(
    "Macro F1 = 0.7",
  );
  expect(screen.getByText(/Recorded coefficients/)).toHaveTextContent(
    "not causation",
  );
  expect(screen.getByText(/confusion matrix not recorded/)).toBeInTheDocument();
});
it("suggests from profile facts for all tasks and gives precise disabled reasons", () => {
  const profile = {
    total_rows: 100,
    sampled_rows: 100,
    columns: [
      { name: "arbitrary_numeric", kind: "numeric", cardinality: 90 },
      { name: "arbitrary_category", kind: "categorical", cardinality: 3 },
      { name: "arbitrary_date", kind: "datetime", cardinality: 80 },
    ],
  } as MLProfile;
  const suggestions = taskSuggestions(profile);
  expect(suggestions.map((s) => s.task)).toEqual([
    "regression",
    "classification",
    "forecasting",
    "clustering",
    "anomaly",
  ]);
  expect(suggestions[0].reason).toContain("90 distinct values");
  expect(suggestions[1].reason).toContain("3 observed classes");
  expect(
    taskSupport(
      { ...profile, columns: profile.columns.slice(0, 2) },
      "forecasting",
    ),
  ).toBe("No date column found.");
  expect(taskSupport({ ...profile, sampled_rows: 10 }, "regression")).toBe(
    "Too few rows to train (minimum 60).",
  );
});
it("reports measured class imbalance at the explicit two-to-one boundary", () => {
  const job = fixture(0.2, false);
  job.task = "classification";
  job.result!.plots.classification = [
    { class: "A", actual: 20, predicted: 20 },
    { class: "B", actual: 10, predicted: 10 },
  ];
  const view = render(<AutoMLSummary job={job} />);
  expect(screen.getByText(/Class imbalance:/)).toBeInTheDocument();
  job.result!.plots.classification[0].actual = 19;
  view.rerender(<AutoMLSummary job={job} />);
  expect(screen.queryByText(/Class imbalance:/)).not.toBeInTheDocument();
});
it("keeps weak Macro F1 visible even when accuracy is high, with no quality badge", () => {
  const job=fixture(0.1,false);job.task="classification";job.result!.leaderboard[0].test_metrics={accuracy:0.95,f1_macro:0.12};job.result!.selection_metric="accuracy";
  render(<AutoMLSummary job={job}/>);
  expect(screen.getByText(/Macro F1 = 0.12/)).toHaveTextContent("accuracy was 95.0%");
  expect(screen.getByText(/Macro F1 =/)).toHaveTextContent("accuracy can conceal errors");
  expect(screen.queryByText(/Good|Fair|Needs work|improvement/)).not.toBeInTheDocument();
});
it.each([1.75,null])("keeps recorded WAPE %s visible without inventing a score or baseline",wape=>{
  const job=fixture(0.1,false);job.task="forecasting";job.configuration.forecast={horizon:7} as typeof job.configuration.forecast;job.result!.leaderboard[0].test_metrics={mae:12,rmse:15,wape};
  render(<AutoMLSummary job={job}/>);
  expect(screen.getByText(/On the final held-out window/)).toHaveTextContent(wape==null?"WAPE was Not measured":"WAPE was 175.0%");
  expect(screen.getByText("Baseline not recorded.")).toBeInTheDocument();
  expect(screen.queryByText(/Good|Fair|Needs work|improvement/)).not.toBeInTheDocument();
});

it("labels the baseline as a simple guess for comparison and keeps the technical names small", () => {
  const { container } = render(<AutoMLSummary job={fixture(0.9)} />);
  expect(screen.getByRole("heading", { name: "How accurate is this?" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: /Simple guess, for comparison/ })).toHaveTextContent("(DummyRegressor)");
  expect(container.querySelector("th small")).toBeTruthy();
});
