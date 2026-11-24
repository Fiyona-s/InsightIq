import {pageLabel} from "../lib/navigation";
import Logo from "./Logo";
import {useAuth} from "../lib/auth";
import {pageAccess} from "../lib/access";
import {
  BookOpen,
  CircleCheck,
  Database,
  Gauge,
  Home,
  LayoutDashboard,
  ListTree,
  History,
  DatabaseBackup,
  Users,
  ScrollText,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  TrendingUp,
  Palette,
  FolderOpen,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
export const OWNER_GROUP = "Your business";
export const ADMIN_GROUP = "Admin tools";
export const modules = [
  { name: "Overview", icon: Home, phase: 4, group: OWNER_GROUP },
  { name: "AI Analyst", icon: MessageSquareText, phase: 2, group: OWNER_GROUP },
  { name: "Data workspace", icon: Database, phase: 1, group: OWNER_GROUP },
  { name: "Dashboards", icon: LayoutDashboard, phase: 4, group: OWNER_GROUP },
  { name: "AutoML Studio", icon: TrendingUp, phase: 6, group: OWNER_GROUP },
  { name: "Knowledge base", icon: BookOpen, phase: 3, group: OWNER_GROUP },
  { name: "Evaluation center", icon: CircleCheck, phase: 4, group: ADMIN_GROUP },
  { name: "Run analytics", icon: Gauge, phase: 4, group: ADMIN_GROUP },
  { name: "Execution traces", icon: ListTree, phase: 3, group: ADMIN_GROUP },
  { name: "Change history", icon: History, phase: 5, group: ADMIN_GROUP },
  { name: "Backup info", icon: DatabaseBackup, phase: 5, group: ADMIN_GROUP },
  { name: "People", icon: Users, phase: 11, group: ADMIN_GROUP },
  { name: "Security log", icon: ScrollText, phase: 11, group: ADMIN_GROUP },
  // Reached from the top-bar menu when sign-in is on.
  { name: "Change password", icon: Settings, phase: 11, group: "Menu" },
  // Reached from the top-bar menu, not the sidebar.
  { name: "Settings", icon: Settings, phase: 9, group: "Menu" },
  { name: "Projects", icon: FolderOpen, phase: 10, group: "Menu" },
  { name: "Design", icon: Palette, phase: 9, group: "Menu" },
];
interface SidebarProps {
  module: string;
  menu: boolean;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  setModule: Dispatch<SetStateAction<string>>;
  setMenu: Dispatch<SetStateAction<boolean>>;
}
export default function Sidebar({
  module,
  menu,
  collapsed,
  setCollapsed,
  setModule,
  setMenu,
}: SidebarProps) {
  const ref = useRef<HTMLElement>(null);
  const auth=useAuth();
  const groups=[OWNER_GROUP];      // Admin pages live under the top-bar Menu, never in the rail

  const [mobile, setMobile] = useState(
    () => window.matchMedia?.("(max-width: 959px)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 959px)");
    if (!media) return;
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (menu && mobile)
      ref.current
        ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
        ?.focus();
  }, [menu, mobile]);
  useEffect(() => {
    if (!mobile || !menu) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobile, menu]);
  function close() {
    setMenu(false);
    document
      .querySelector<HTMLButtonElement>('[aria-label="Toggle navigation"]')
      ?.focus();
  }
  return (
    <aside
      ref={ref}
      id="workspace-navigation"
      aria-label="Workspace navigation"
      role={mobile && menu ? "dialog" : undefined}
      aria-modal={mobile && menu ? true : undefined}
      className={menu ? "sidebar open" : "sidebar"}
      inert={mobile && !menu}
      onKeyDown={(e) => {
        if (!mobile || !menu) return;
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
        if (e.key === "Tab") {
          const controls = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), a[href]",
            ) || [],
          ).filter((el) => el.getClientRects().length);
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="sidebar-brand-row">
        <a className="brand" href="#overview" aria-label="InsightIQ home" onClick={event=>{event.preventDefault();setModule("Overview");if(mobile)close();}}>
          <Logo size={28} />
          <span className="brand-name">
            Insight<span>IQ</span>
          </span>
        </a>
        <button
          className="sidebar-collapse"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
        <button
          className="sidebar-mobile-close"
          aria-label="Close navigation"
          onClick={close}
        >
          ×
        </button>
      </div>
      <nav aria-label="Main navigation">
        {groups.map((group) => (
          <div className="nav-group" key={group} >
            <div>
            {modules
              .filter((m) => m.group === group && pageAccess(m.name, auth.role).allowed)
              .map((m) => (
                <button
                  key={m.name}
                  title={collapsed ? pageLabel(m.name) : undefined}
                  aria-label={pageLabel(m.name)}
                  aria-current={module === m.name ? "page" : undefined}
                  className={module === m.name ? "nav-item active" : "nav-item"}
                  onClick={() => {
                    setModule(m.name);
                    if (mobile) close();
                    else setMenu(false);
                  }}
                >
                  <m.icon size={18} />
                  <span className="nav-text">{pageLabel(m.name)}</span>
                </button>
              ))}</div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
