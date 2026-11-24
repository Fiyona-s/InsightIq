import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Toast = { id: number; message: ReactNode };
const ToastContext = createContext<(message: ReactNode) => void>(() => {});

/** Short, polite confirmations ("Saved"). Errors that need action stay inline (ErrorState). */
export function ToastProvider({ children, timeout = 6000 }: { children: ReactNode; timeout?: number }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: ReactNode) => setToasts(list => [...list.slice(-2), { id: Date.now() + Math.random(), message }]), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="ui-toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map(toast => <ToastItem key={toast.id} toast={toast} timeout={timeout} onDone={() => setToasts(list => list.filter(t => t.id !== toast.id))} />)}
      </div>
    </ToastContext.Provider>
  );
}
function ToastItem({ toast, timeout, onDone }: { toast: Toast; timeout: number; onDone: () => void }) {
  useEffect(() => { const t = window.setTimeout(onDone, timeout); return () => window.clearTimeout(t); }, [timeout, onDone]);
  return <div className="ui-toast"><span>{toast.message}</span><button type="button" onClick={onDone}>Dismiss</button></div>;
}
export const useToast = () => useContext(ToastContext);
