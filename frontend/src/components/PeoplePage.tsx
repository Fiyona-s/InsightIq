import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { Card, PageHeader, StatusChip } from "./ui/layout";
import { Button } from "./ui/button";
import { Menu, type MenuItem } from "./ui/menu";
import { Modal } from "./ui/overlay";
import { TableFrame } from "./ui/data";
import { EmptyState } from "./ui/states";
import { ErrorState, LoadingState } from "./WorkspaceStates";
import { useToast } from "./ui/toast";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL, type Role } from "../lib/access";
import { formatDate } from "../lib/formatters";
import { linkUrl, peopleApi, type LinkResult, type Person } from "../lib/peopleApi";

/** The owner's People page (Accounts A4). Plain words; the server enforces every rule shown here. */
const ROLE_HELP: Record<Role, string> = {
  viewer: "Can open dashboards and the rows pinned to them.",
  analyst: "Can upload data, ask questions, build dashboards and predictions.",
  owner: "Can do everything, including managing people.",
};

export default function PeoplePage() {
  const toast = useToast(), auth = useAuth();
  const [people, setPeople] = useState<Person[] | null>(null), [error, setError] = useState("");
  const [inviting, setInviting] = useState(false), [link, setLink] = useState<{ title: string; result: LinkResult } | null>(null);
  const [roleFor, setRoleFor] = useState<Person | null>(null), [deactivating, setDeactivating] = useState<Person | null>(null);
  const load = useCallback(async () => {
    setError("");
    try { setPeople(await peopleApi.list()); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(task: () => Promise<unknown>, done: string) {
    try { await task(); toast(done); await load(); return ""; } catch (e) { return (e as Error).message; }
  }
  const items = (p: Person): MenuItem[] => [
    { label: "Change role", onSelect: () => setRoleFor(p) },
    ...(p.status === "Locked" ? [{ label: "Unlock", onSelect: () => void run(() => peopleApi.unlock(p.id), `${p.email} is unlocked.`) }] : []),
    ...(p.active ? [{ label: "Create a link to set a password", onSelect: async () => { try { setLink({ title: `Link for ${p.email}`, result: await peopleApi.resetLink(p.id) }); await load(); } catch (e) { setError((e as Error).message); } } }] : []),
    ...(p.active
      ? (p.email === auth.user?.email ? [] : [{ label: "Deactivate", danger: true, onSelect: () => setDeactivating(p) }])
      : [{ label: "Reactivate", onSelect: () => void run(() => peopleApi.change(p.id, { active: true }), `${p.email} is active again.`) }]),
  ];

  return (
    <div className="people-page">
      <PageHeader title="People" description="Who can sign in to this workspace, and what each person can do."
        actions={<Button onClick={() => setInviting(true)}><UserPlus size={16} aria-hidden="true" /> Invite a person</Button>} />
      {error && <ErrorState role="alert">{error} <Button variant="ghost" onClick={() => void load()}>Try again</Button></ErrorState>}
      {!people && !error && <LoadingState>Loading people…</LoadingState>}
      {people && (
        <Card title="Everyone in this workspace" headingLevel={2}>
          {!people.length ? <EmptyState as="p">There is no one yet.</EmptyState> : (
            <TableFrame label="People">
              <table className="ui-table people-table">
                <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Two-step</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td>{p.display_name}</td><td>{p.email}</td><td>{ROLE_LABEL[p.role]}</td>
                      <td><StatusChip tone={p.status === "Active" ? "success" : p.status === "Invited" ? "info" : "warning"}>{p.status}</StatusChip></td>
                      <td>{p.two_step ?? "Not used"}</td>
                      <td>{p.last_sign_in ? formatDate(p.last_sign_in, "datetime") : "Never"}</td>
                      <td className="dataset-actions-cell"><Menu variant="ghost" label={`Actions for ${p.email}`} items={items(p)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </Card>
      )}
      {inviting && <InviteDialog onClose={() => setInviting(false)} onInvited={(result) => { setInviting(false); setLink({ title: `Link for ${result.user.email}`, result }); void load(); }} />}
      {link && <LinkDialog title={link.title} result={link.result} onClose={() => setLink(null)} />}
      {roleFor && <RoleDialog person={roleFor} onClose={() => setRoleFor(null)} onSave={(role) => run(() => peopleApi.change(roleFor.id, { role }), `${roleFor.email} is now ${ROLE_LABEL[role as Role]}.`)} />}
      {deactivating && (
        <ConfirmDialog person={deactivating} onClose={() => setDeactivating(null)}
          onConfirm={() => run(() => peopleApi.change(deactivating.id, { active: false }), `${deactivating.email} is deactivated and signed out.`)} />
      )}
    </div>
  );
}

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: (result: LinkResult) => void }) {
  const [email, setEmail] = useState(""), [name, setName] = useState(""), [role, setRole] = useState<Role>("analyst"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError("");
    try { onInvited(await peopleApi.invite(email, name, role)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Invite a person" busy={busy} onClose={onClose} footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !email.trim()} onClick={() => void submit()}>{busy ? "Creating…" : "Create invitation"}</Button></>}>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></label>
      <label>Name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
      <label>Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(["viewer", "analyst", "owner"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      <p className="insight-note">{ROLE_HELP[role]}</p>
      <p className="insight-note">You will get a link to give to this person. They choose their own password; you never see it.</p>
      {error && <ErrorState as="p" role="alert">{error}</ErrorState>}
    </Modal>
  );
}

function LinkDialog({ title, result, onClose }: { title: string; result: LinkResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = linkUrl(result.token);
  return (
    <Modal open title={title} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <p>Copy this link now. <strong>It is shown only once.</strong> It works once and for {result.expires_hours} hours. Send it to {result.user.email} yourself; they choose their own password.</p>
      <label>One-time link<input readOnly value={url} onFocus={(e) => e.currentTarget.select()} /></label>
      <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copied" : "Copy link"}</Button>
    </Modal>
  );
}

function RoleDialog({ person, onClose, onSave }: { person: Person; onClose: () => void; onSave: (role: string) => Promise<string> }) {
  const [role, setRole] = useState<Role>(person.role), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function save() { setBusy(true); const message = await onSave(role); setBusy(false); if (message) setError(message); else onClose(); }
  return (
    <Modal open title={`Change role for ${person.email}`} busy={busy} onClose={onClose} footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || role === person.role} onClick={() => void save()}>Save role</Button></>}>
      <label>Role
        <select value={role} onChange={(e) => { setRole(e.target.value as Role); setError(""); }}>
          {(["viewer", "analyst", "owner"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      <p className="insight-note">{ROLE_HELP[role]}</p>
      {error && <ErrorState as="p" role="alert">{error}</ErrorState>}
    </Modal>
  );
}

function ConfirmDialog({ person, onClose, onConfirm }: { person: Person; onClose: () => void; onConfirm: () => Promise<string> }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function go() { setBusy(true); const message = await onConfirm(); setBusy(false); if (message) setError(message); else onClose(); }
  return (
    <Modal open title={`Deactivate ${person.email}?`} busy={busy} onClose={onClose} footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Keep active</Button><Button variant="danger" disabled={busy} onClick={() => void go()}>Deactivate</Button></>}>
      <p>{person.display_name} will be signed out at once and cannot sign in until you reactivate them. Their questions, dashboards and other work stay as they are.</p>
      {error && <ErrorState as="p" role="alert">{error}</ErrorState>}
    </Modal>
  );
}
