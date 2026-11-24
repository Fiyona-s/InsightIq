import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import AutoMLStudio from "./AutoMLStudio";
import {
  automlApi,
  type MLProfile,
  type MLExperiment,
  type MLModel,
  type MLPrediction,
  type MLConfiguration,
} from "../automlapi";
import type { Dataset } from "../api";
vi.mock("../automlapi", () => ({
  automlApi: {
    profile: vi.fn(),
    inputSchema: vi.fn(),
    validate: vi.fn(),
    validateInput: vi.fn(),
    experiments: vi.fn(),
    experiment: vi.fn(),
    train: vi.fn(),
    models: vi.fn(),
    predictions: vi.fn(),
    predict: vi.fn(),
    prediction: vi.fn(),
    cancel: vi.fn(),
    deleteExperiment: vi.fn(),
    deletePrediction: vi.fn(),
    leakage: vi.fn(),
  },
}));
vi.mock("./AutoMLPlots", () => ({
  default: () => <div>Actual fixture plot boundary</div>,
}));
const dataset: Dataset = {
  id: "dataset-fixture",
  name: "SYNTHETIC-TEST.csv",
  rows: 120,
  bytes: 1000,
  created_at: "2026-01-01",
  columns: [
    "record_id",
    "x",
    "region",
    "amount",
    "order_date",
    "customer_id",
    "order_status",
  ].map((name) => ({ name, type: "VARCHAR", null_count: 0 })),
};
const columns = dataset.columns.map((c) => ({
  name: c.name,
  kind:
    c.name === "order_date"
      ? ("datetime" as const)
      : c.name === "x" || c.name === "amount"
        ? ("numeric" as const)
        : ("categorical" as const),
  missing: 0,
  cardinality: c.name === "region" ? 2 : 100,
  constant: false,
  potential_identifier: c.name.endsWith("_id"),
  potential_leakage: c.name === "order_status",
  high_cardinality: false,
  numeric_valid: 120,
  date_valid: 120,
  minimum: 0,
  maximum: 20,
  date_start: null,
  date_end: null,
}));
const profile: MLProfile = {
  dataset_id: dataset.id,
  dataset_name: dataset.name,
  fingerprint: "content-fingerprint",
  total_rows: 120,
  sampled_rows: 120,
  sampled: false,
  duplicate_rows: 3,
  columns,
  target_distribution: null,
  readiness: { ready: true, reasons: [], warnings: [] },
  policy: "Fixture types are suggestions; training-only preprocessing.",
};
const config: MLConfiguration = {
  dataset_id: dataset.id,
  title: "Fixture measured experiment",
  task: "regression",
  target: "amount",
  features: [
    { name: "x", kind: "numeric" },
    { name: "region", kind: "categorical" },
  ],
  scaler: "standard",
  seed: 42,
  clusters: 3,
  contamination: 0.05,
  confirm_feature_availability: true,
};
const completed: MLExperiment = {
  id: "experiment-fixture",
  dataset_id: dataset.id,
  dataset_name: dataset.name,
  dataset_fingerprint: profile.fingerprint,
  title: config.title,
  task: "regression",
  status: "completed",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  completed_at: "2026-01-01",
  duration_seconds: 0.5,
  configuration: config,
  limits: { max_rows: 5000 },
  error: null,
  error_code: null,
  result: {
    leaderboard: [
      {
        algorithm: "Ridge",
        status: "completed",
        training_metrics: { rmse: 1 },
        validation_metrics: { rmse: 2 },
        test_metrics: { rmse: 2.2, r2: 0.5 },
        fit_seconds: 0.01,
        selected: true,
        model_id: "model-fixture",
      },
    ],
    selected_model_id: "model-fixture",
    selection_metric: "rmse",
    selection_split: "validation",
    split: {
      train: { count: 72 },
      validation: { count: 24 },
      test: { count: 24 },
    },
    plots: {
      regression: [{ row_index: 1, actual: 10, predicted: 9, residual: 1 }],
    },
    details: {},
    rows_used: 120,
    warnings: [],
    scope:
      "Model selection uses validation only. Test rows remain untouched until selection.",
    feature_importance: { method: "No fixture importance.", values: [] },
  },
};
const model: MLModel = {
  id: "model-fixture",
  experiment_id: completed.id,
  dataset_id: dataset.id,
  dataset_fingerprint: profile.fingerprint,
  algorithm: "Ridge",
  task: "regression",
  created_at: "2026-01-01",
  hyperparameters: { alpha: 1 },
  metrics: { test: { rmse: 2.2 } },
  feature_schema: config.features,
  selected: true,
  selection_metric: "validation rmse",
  artifact_path: "automl/models/model-fixture.joblib",
  artifact_sha256: "checksum",
  versions: { sklearn: "1.6.1" },
  configuration: config,
};
const predicted: MLPrediction = {
  id: "prediction-fixture",
  model_id: model.id,
  dataset_id: null,
  created_at: "2026-01-01",
  row_count: 1,
  scope: "User-supplied records; not labeled evaluation.",
  columns: ["row_index", "prediction"],
  rows: [{ row_index: 0, prediction: 12.34 }],
  offset: 0,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(automlApi.inputSchema).mockResolvedValue({
    model_id: "m",
    dataset_name: "test.csv",
    dataset_fingerprint: "f",
    source_status: "matches",
    scope: "Recorded rows",
    features: [],
  });
  vi.mocked(automlApi.validate).mockResolvedValue({ ready: true, reasons: [] });
  vi.mocked(automlApi.validateInput).mockResolvedValue({
    valid: true,
    rows: 1,
    rejected_row_count: 0,
    rejected_rows: [],
  });
  vi.mocked(automlApi.experiments).mockResolvedValue([]);
  vi.mocked(automlApi.models).mockResolvedValue([]);
  vi.mocked(automlApi.predictions).mockResolvedValue([]);
  vi.mocked(automlApi.profile).mockImplementation(
    async (_id, task, target) => ({
      ...profile,
      readiness: {
        ready: !["regression", "classification"].includes(task) || !!target,
        reasons:
          !["regression", "classification"].includes(task) || target
            ? []
            : ["Select a target column."],
        warnings: [],
      },
    }),
  );
  vi.mocked(automlApi.train).mockResolvedValue({
    ...completed,
    status: "queued",
    result: null,
  });
  vi.mocked(automlApi.experiment).mockResolvedValue(completed);
  vi.mocked(automlApi.predict).mockResolvedValue(predicted);
});
async function taskStep() {
  // Stage 1 ("What do you want to predict?") is the first screen: wait for the profile.
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Your data" })).not.toHaveTextContent("Checking"),
  );
}
const NEXT = "Next: check and train";
async function configure() {
  await taskStep();
  await userEvent.click(
    screen.getByRole("button", { name: /Predict a number/ }),
  );
  await userEvent.selectOptions(
    await screen.findByLabelText("Target column"),
    "amount",
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: NEXT })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: NEXT }));
  await waitFor(() =>
    expect(screen.getByLabelText("Use feature x")).toBeChecked(),
  );
}
it("requires registered data and never starts training automatically", async () => {
  render(<AutoMLStudio datasets={[]} />);
  expect(
    screen.getByText("Your next model starts with data"),
  ).toBeInTheDocument();
  expect(automlApi.train).not.toHaveBeenCalled();
  expect(automlApi.predict).not.toHaveBeenCalled();
  expect(automlApi.profile).not.toHaveBeenCalled();
});
it("profiles data, excludes identifiers/outcomes, and requires target and feature availability confirmation", async () => {
  render(<AutoMLStudio datasets={[dataset]} />);
  await taskStep();
  expect(screen.queryByText("Select a target column.")).not.toBeInTheDocument();   // nothing is said before a task is chosen
  await userEvent.click(screen.getByRole("button", { name: /Predict a number/ }));
  expect(await screen.findByText("Select a target column.")).toBeInTheDocument();  // ...and then the reason appears, once
  expect(
    screen.queryByRole("button", { name: "Train local models" }),
  ).not.toBeInTheDocument();      // training is only offered on the second step
  await configure();
  expect(screen.getByLabelText("Use feature record_id")).toBeDisabled();
  expect(screen.getByLabelText("Use feature order_status")).toBeDisabled();
  expect(screen.queryByLabelText("Use feature amount")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Train local models" })).toBeDisabled();
  await userEvent.click(screen.getByLabelText(/I confirm selected predictors/));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Train local models" })).toBeEnabled(),
  );
  expect(automlApi.train).not.toHaveBeenCalled();
});
it("renders task-specific controls and RFM roles without irrelevant target/feature controls", async () => {
  render(<AutoMLStudio datasets={[dataset]} />);
  await taskStep();
  await userEvent.click(
    screen.getByRole("button", { name: /Group similar records/ }),
  );
  expect(screen.queryByLabelText("Target column")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: NEXT }));
  await userEvent.selectOptions(
    screen.getByLabelText("Clustering features"),
    "rfm",
  );
  expect(screen.getByLabelText("Customer identifier")).toBeInTheDocument();
  expect(screen.queryByLabelText("Use feature x")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /1\s*What do you want to predict/ }));
  await userEvent.click(
    screen.getByRole("button", { name: /Find unusual records/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: NEXT }));
  await userEvent.click(screen.getByText("Advanced settings", { exact: true }));
  expect(
    screen.getByLabelText("Expected flagged fraction (%)"),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Customer identifier"),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /1\s*What do you want to predict/ }));
  await userEvent.click(
    screen.getByRole("button", { name: /Forecast future values/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: NEXT }));
  expect(screen.getByLabelText("Forecast horizon")).toBeInTheDocument();
  expect(screen.getByLabelText("Missing periods")).toHaveValue("error");
  expect(screen.queryByLabelText("Numerical scaling")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Random seed")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Target column")).not.toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByLabelText("Aggregation frequency"),
    "month",
  );
  expect(screen.getByLabelText("Forecast horizon")).toHaveValue(1);
  expect(automlApi.train).not.toHaveBeenCalled();
});
it("submits confirmed configuration, polls actual job state and displays measured held-out results", async () => {
  vi.mocked(automlApi.models).mockResolvedValue([model]);
  render(<AutoMLStudio datasets={[dataset]} />);
  await configure();
  await userEvent.click(screen.getByLabelText(/I confirm selected predictors/));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Train local models" })).toBeEnabled(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Train local models" }),
  );
  await screen.findByRole("region", { name: "AutoML experiment results" });
  expect(automlApi.train).toHaveBeenCalledWith(
    expect.objectContaining({
      dataset_id: dataset.id,
      target: "amount",
      task: "regression",
      confirm_feature_availability: true,
    }),
  );
  const results = screen.getByRole("region", {
    name: "AutoML experiment results",
  });
  expect(results).toHaveTextContent("Test rows remain untouched");
  expect(results).toHaveTextContent("2.2");
  expect(results).toHaveTextContent("n=24");
  expect(results).toHaveTextContent("Selection: rmse on validation");
  expect(automlApi.predict).not.toHaveBeenCalled();
});
it("validates explicit prediction action and shows saved-model output/CSV without fabricating accuracy", async () => {
  vi.mocked(automlApi.models).mockResolvedValue([model]);
  render(<AutoMLStudio datasets={[dataset]} />);
  await userEvent.click(
    await screen.findByRole("button", { name: /Results and predict/ }),
  );
  await userEvent.selectOptions(
    await screen.findByLabelText("Saved model"),
    model.id,
  );
  await userEvent.type(screen.getByLabelText("Prediction feature x"), "2.5");
  await userEvent.type(
    screen.getByLabelText("Prediction feature region"),
    "NEW",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Predict with saved model" }),
  );
  const result = await screen.findByRole("region", {
    name: "ML prediction results",
  });
  expect(automlApi.predict).toHaveBeenCalledWith(model.id, {
    records: [{ x: "2.5", region: "NEW" }],
  });
  expect(within(result).getByText("12.34")).toBeInTheDocument();
  expect(result).toHaveTextContent("not labeled evaluation");
  expect(
    within(result).getByRole("link", { name: "Export prediction CSV" }),
  ).toHaveAttribute(
    "href",
    "/api/automl/predictions/prediction-fixture/export.csv",
  );
});
it("reports backend failures and permits a clear retry without showing invented model scores", async () => {
  vi.mocked(automlApi.train).mockRejectedValue(
    new Error("Grouped split lacks enough independent examples."),
  );
  render(<AutoMLStudio datasets={[dataset]} />);
  await configure();
  await userEvent.click(screen.getByLabelText(/I confirm selected predictors/));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Train local models" })).toBeEnabled(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Train local models" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Grouped split lacks enough independent examples",
  );
  expect(
    screen.queryByRole("region", { name: "AutoML experiment results" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Train local models" }),
  ).toBeEnabled();
});
it("cancels a queued or running experiment and keeps terminal state explicit", async () => {
  vi.mocked(automlApi.experiment).mockResolvedValue({
    ...completed,
    status: "cancelled",
    result: null,
    error: "Training cancelled.",
  });
  vi.mocked(automlApi.cancel).mockResolvedValue({
    ...completed,
    status: "running",
    result: null,
  });
  render(<AutoMLStudio datasets={[dataset]} />);
  await configure();
  await userEvent.click(screen.getByLabelText(/I confirm selected predictors/));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Train local models" })).toBeEnabled(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Train local models" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Cancel training" }),
  );
  expect(automlApi.cancel).toHaveBeenCalledWith(completed.id);
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "ML training progress" }),
    ).toHaveTextContent("cancelled"),
  );
  expect(
    screen.queryByRole("region", { name: "AutoML experiment results" }),
  ).not.toBeInTheDocument();
});

it("selects the completed model after a delayed registry refresh", async () => {
  let calls = 0;
  vi.mocked(automlApi.models).mockImplementation(async () => {
    calls++;
    if (calls > 1) await new Promise((resolve) => setTimeout(resolve, 30));
    return calls === 1 ? [] : [model];
  });
  render(<AutoMLStudio datasets={[dataset]} />);
  await configure();
  await userEvent.click(screen.getByLabelText(/I confirm selected predictors/));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Train local models" })).toBeEnabled(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Train local models" }),
  );
  await screen.findByRole("region", { name: "AutoML experiment results" });
  expect(
    await screen.findByLabelText("Prediction feature x"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Saved model")).toHaveValue(model.id);
});
it("wizard gates suggestions, preserves Back state, focuses headings and resets Advanced defaults", async () => {
  render(<AutoMLStudio datasets={[dataset]} />);
  await taskStep();
  expect(
    screen
      .getByRole("navigation", { name: "Model workflow" })
      .querySelector('[aria-current="step"]'),
  ).toHaveTextContent("What do you want to predict?");
  expect(screen.getByLabelText("Target column")).toHaveValue("");
  expect(screen.getByRole("button", { name: NEXT })).toBeDisabled();
  expect(automlApi.train).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: /Predict a number/ }),
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Target column"),
    "amount",
  );
  await userEvent.click(screen.getByRole("button", { name: NEXT }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Check and train" })).toHaveFocus(),
  );
  const advanced = screen.getByText("Advanced settings", { exact: true });
  expect(advanced.closest("details")).not.toHaveAttribute("open");
  await userEvent.click(advanced);
  await userEvent.clear(screen.getByLabelText("Random seed"));
  await userEvent.type(screen.getByLabelText("Random seed"), "9");
  expect(
    screen.getByText("Advanced settings differ from defaults."),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Reset to defaults" }),
  );
  expect(screen.getByLabelText("Random seed")).toHaveValue(42);
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Target column")).toHaveValue("amount");
});
it("recovers a running job from history into Train without submitting training", async () => {
  const running = { ...completed, status: "running" as const, result: null };
  vi.mocked(automlApi.experiments).mockResolvedValue([running]);
  vi.mocked(automlApi.experiment).mockResolvedValue(running);
  render(<AutoMLStudio datasets={[dataset]} />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Check and train" })).toBeInTheDocument(),
  );
  expect(
    screen.getByRole("region", { name: "ML training progress" }),
  ).toHaveTextContent(dataset.name);
  expect(screen.queryByLabelText("Target column")).not.toBeInTheDocument();
  expect(automlApi.train).not.toHaveBeenCalled();
});
it("shows five task goals with technical labels and applies optional suggestions only explicitly",async()=>{
 render(<AutoMLStudio datasets={[dataset]}/>);await taskStep();
 for(const name of ['Predict a number','Predict a category','Group similar records','Find unusual records','Forecast future values'])expect(screen.getByRole('button',{name:new RegExp(name)})).toHaveAttribute('aria-pressed','false');
 expect(screen.getByRole('button',{name:/Group similar records/})).not.toHaveTextContent('customer');
 const suggestions=screen.getByText(/Profile-based suggestions/).closest('details')!;expect(suggestions).not.toHaveAttribute('open');
 expect(screen.getByLabelText('Target column')).toHaveValue('');await userEvent.click(screen.getByText(/Profile-based suggestions/));
 await userEvent.click(screen.getAllByRole('button',{name:'Use suggestion'})[0]);expect(screen.getByLabelText('Target column')).not.toHaveValue('');
 expect(automlApi.train).not.toHaveBeenCalled();await userEvent.click(screen.getByRole('button',{name:NEXT}));
 expect(document.querySelector('.ml-target-summary')).toHaveTextContent('Target:');expect(screen.getByText(/One fixed grouped 60\/20\/20/)).toBeVisible();expect(screen.getByLabelText(/I confirm selected predictors/)).toBeVisible();expect(screen.getByText('Advanced settings',{exact:true}).closest('details')).not.toHaveAttribute('open');
 expect(automlApi.train).not.toHaveBeenCalled();
});

it("names columns that may give away the answer, before training, and never blocks training", async () => {
  vi.mocked(automlApi.leakage).mockResolvedValue({ rows_checked: 120, findings: [{ column: "x", rule: "A", sentence: "When x is 0, amount is always 5 (30 of 30 rows)." }] });
  render(<AutoMLStudio datasets={[dataset]} />);
  await configure();
  const warning = await screen.findByRole("alert", { name: "Columns that may give away the answer" });
  expect(warning).toHaveTextContent("When x is 0, amount is always 5 (30 of 30 rows).");
  expect(warning).toHaveTextContent("These columns may give away the answer");
  expect(warning).toHaveTextContent("only a warning, not a finding");
  expect(automlApi.leakage).toHaveBeenCalledWith(dataset.id, "regression", "amount", expect.arrayContaining(["x"]));
  await userEvent.click(screen.getByLabelText(/I confirm selected predictors/));
  await waitFor(() => expect(screen.getByRole("button", { name: "Train local models" })).toBeEnabled());   // a warning never blocks
  expect(automlApi.train).not.toHaveBeenCalled();
});

it("has three guided steps, shows the not-ready reason once, and keeps earlier experiments collapsed", async () => {
  vi.mocked(automlApi.experiments).mockResolvedValue([completed]);
  render(<AutoMLStudio datasets={[dataset]} />);
  await taskStep();
  const stages = within(screen.getByRole("navigation", { name: "Model workflow" })).getAllByRole("button");
  expect(stages.map((b) => b.textContent)).toEqual(["1What do you want to predict?", "2Check and train", "3Results and predict"]);
  expect(screen.queryByText("Select a target column.")).not.toBeInTheDocument();           // no premature notice
  await userEvent.click(screen.getByRole("button", { name: /Predict a number/ }));
  expect(await screen.findAllByText("Select a target column.")).toHaveLength(1);           // shown once, only for the chosen task
  expect(screen.getByText(/Earlier experiments \(1\)/).closest("details")).not.toHaveAttribute("open");
  expect(screen.getAllByRole("button", { name: NEXT })).toHaveLength(1);                    // one primary action
});
