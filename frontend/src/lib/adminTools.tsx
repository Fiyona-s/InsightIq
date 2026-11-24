import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useAuth } from "./auth";

/**
 * Whether Admin / Developer tools are shown. This is a display preference only:
 * it is NOT access control. The UI says so wherever the tools appear (Rule 7).
 */
const KEY = "insightiq-admin-tools-v1";
type Value = { enabled: boolean; setEnabled: (value: boolean) => void };
const AdminToolsContext = createContext<Value>({ enabled: false, setEnabled: () => {} });

function read() {
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
}

export function AdminToolsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [stored, set] = useState(read);
  // Login on: the Admin pages follow the owner role and the browser switch is not used. Login off: the switch, as before.
  const enabled = auth.hosted ? auth.role === "owner" : stored;
  const setEnabled = useCallback((value: boolean) => {
    set(value);
    try { localStorage.setItem(KEY, String(value)); } catch { /* Preference is optional. */ }
  }, []);
  return <AdminToolsContext.Provider value={{ enabled, setEnabled: auth.hosted ? () => {} : setEnabled }}>{children}</AdminToolsContext.Provider>;
}
export const useAdminTools = () => useContext(AdminToolsContext);
export const ADMIN_NOTICE = "Admin tools: not protected by a login. Anyone using this computer can open them.";
/** The line shown on Admin pages. Login on: a plain role statement. Login off: the honest local-mode warning. */
export const ADMIN_NOTICE_OWNER = "Admin tools: shown to owners.";
export function useAdminNotice() { return useAuth().hosted ? ADMIN_NOTICE_OWNER : ADMIN_NOTICE; }
