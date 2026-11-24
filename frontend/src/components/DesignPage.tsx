import { useState } from "react";
import { Database, Plus } from "lucide-react";
import {
  Button, Card, DataTable, Drawer, EmptyState, ErrorState, LoadingState, Modal, PageHeader,
  Skeleton, StatusChip, TableFrame, Tabs, useToast,
} from "./ui";

/** Development-only catalogue of the design system (route #design, dev builds only). */
const COLORS = ["brand-900", "brand-700", "brand-600", "brand-500", "brand-300", "brand-100", "brand-50",
  "neutral-900", "neutral-800", "neutral-700", "neutral-600", "neutral-500", "neutral-300", "neutral-200", "neutral-100", "neutral-50", "neutral-25", "neutral-0",
  "success-text", "success-bg", "warning-text", "warning-bg", "danger-text", "danger-bg", "info-text", "info-bg"];
const TYPE = [["text-metric", "36px · big numbers"], ["text-2xl", "28px · page title"], ["text-xl", "22px · section title"],
  ["text-lg", "18px · card title"], ["text-base", "16px · body"], ["text-sm", "14px · metadata (minimum)"]];
const SPACE = ["space-half", "space-1", "space-1h", "space-2", "space-3", "space-4", "space-5", "space-6", "space-8"];
const rows = [
  { region: "East", revenue: "2,079,849.23", orders: 600 },
  { region: "North", revenue: "2,038,771.07", orders: 598 },
  { region: "West", revenue: "2,224,787.70", orders: 602 },
];

export default function DesignPage() {
  const [tab, setTab] = useState("one");
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const toast = useToast();
  return (
    <div className="design-grid">
      <PageHeader title="Design system" description="Tokens and shared components. Development builds only."
        actions={<Button onClick={() => toast("Saved. This is a toast.")}><Plus size={16} /> Primary action</Button>} />

      <Card title="Colour" description="One brand colour, neutrals and semantic colours.">
        <div className="design-swatches">
          {COLORS.map(c => <div className="design-swatch" key={c}><span style={{ background: `var(--${c})` }} /><code>--{c}</code></div>)}
        </div>
      </Card>

      <Card title="Type scale" description="14px is the minimum for any visible text.">
        <div className="design-type">
          {TYPE.map(([t, note]) => <p key={t} style={{ fontSize: `var(--${t})` }}>{note}</p>)}
        </div>
      </Card>

      <Card title="Spacing" description="8px grid, 4px for tight inline gaps.">
        <div className="design-row">
          {SPACE.map(s => <span key={s} className="ui-chip ui-chip-neutral" style={{ paddingInline: `var(--${s})` }}>--{s}</span>)}
        </div>
      </Card>

      <Card title="Buttons" description="One primary per screen.">
        <div className="design-row">
          <Button>Primary</Button><Button variant="outline">Secondary</Button><Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button><Button size="sm" variant="outline">Small</Button><Button disabled>Disabled</Button>
        </div>
      </Card>

      <Card title="Status chips">
        <div className="design-row">
          <StatusChip>Neutral</StatusChip><StatusChip tone="success">Answered</StatusChip><StatusChip tone="warning">Needs review</StatusChip>
          <StatusChip tone="danger">Failed</StatusChip><StatusChip tone="info">Updated today</StatusChip>
        </div>
      </Card>

      <Card title="States">
        <div className="design-grid">
          <LoadingState>Loading your datasets…</LoadingState>
          <Skeleton height={20} width="60%" label="Loading" />
          <EmptyState>No answers yet.</EmptyState>
          <EmptyState title="No dashboards yet" icon={<Database size={24} />} action={<Button>Create a dashboard</Button>}>Pin an answer to start your first dashboard.</EmptyState>
          <ErrorState details={'{"code":"example"}'}>We could not load this page. Try again.</ErrorState>
        </div>
      </Card>

      <Card title="Tabs">
        <Tabs label="Example tabs" value={tab} onChange={setTab} panelId="design-tab-panel"
          items={[{ value: "one", label: "Preview" }, { value: "two", label: "Columns" }, { value: "three", label: "Health" }]} />
        <div id="design-tab-panel" role="tabpanel" style={{ paddingTop: "var(--space-2)" }}>Selected: {tab}</div>
      </Card>

      <Card title="Data table" description="Scrolls inside its own frame on small screens.">
        <DataTable label="Revenue by region" rowKey={r => r.region} rows={rows}
          columns={[{ key: "region", header: "Region", cell: r => r.region },
            { key: "revenue", header: "Revenue", cell: r => r.revenue, numeric: true },
            { key: "orders", header: "Orders", cell: r => r.orders, numeric: true }]} />
        <TableFrame label="Wide example" style={{ marginTop: "var(--space-2)" }}>
          <table className="ui-table"><tbody><tr>{Array.from({ length: 14 }, (_, i) => <td key={i}>Column {i + 1}</td>)}</tr></tbody></table>
        </TableFrame>
      </Card>

      <Card title="Modal, drawer and toast">
        <div className="design-row">
          <Button variant="outline" onClick={() => setModal(true)}>Open modal</Button>
          <Button variant="outline" onClick={() => setDrawer(true)}>Open drawer</Button>
          <Button variant="outline" onClick={() => toast("Dashboard saved.")}>Show toast</Button>
        </div>
        <Modal open={modal} title="Delete this dashboard?" onClose={() => setModal(false)}
          footer={<><Button variant="outline" onClick={() => setModal(false)}>Cancel</Button><Button variant="danger" onClick={() => setModal(false)}>Delete</Button></>}>
          <p>This removes the dashboard. Saved answers stay in your history.</p>
        </Modal>
        <Drawer open={drawer} title="Details" onClose={() => setDrawer(false)}>
          <p>Drawers hold secondary details without leaving the page.</p>
        </Drawer>
      </Card>
    </div>
  );
}
