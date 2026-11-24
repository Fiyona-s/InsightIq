import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {DatasetNamesProvider} from "./lib/datasetNames";
import {AuthGate} from "./lib/auth";
import {syncProjectCookie} from "./lib/projects";
import "./styles/tokens.css";
import "./index.css";
import "./workspace.css";
import "./styles/components.css";
// Stage 2: scope the very first API calls to the remembered project.
syncProjectCookie();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate><DatasetNamesProvider><App /></DatasetNamesProvider></AuthGate>
  </React.StrictMode>,
);
