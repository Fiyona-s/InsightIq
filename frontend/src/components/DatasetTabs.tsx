import { Tabs } from "./ui/tabs";
import { Table2, Columns3 } from "lucide-react";
export const datasetViews = [
  { key: "Data preview", label: "Preview", id: "preview-tab", icon: Table2 },
  { key: "Schema", label: "Columns", id: "schema-tab", icon: Columns3 },
];
export function datasetTabId(value: string) {
  return datasetViews.find((tab) => tab.key === value)?.id || "preview-tab";
}
export default function DatasetTabs({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Tabs
      label="Dataset view"
      value={value}
      onChange={onChange}
      panelId="dataset-panel"
      className="tabs"
      items={datasetViews.map((tab) => ({ value: tab.key, label: tab.label, id: tab.id, icon: <tab.icon size={16} aria-hidden="true" /> }))}
    />
  );
}
