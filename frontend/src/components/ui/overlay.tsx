import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "../../lib/utils";

type ModalProps = {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Prevent closing (e.g. while saving). */
  busy?: boolean;
  className?: string;
  closeLabel?: string;
  variant?: "modal" | "drawer";
  /** Explicit accessible name; use only when it must differ from the visible title. */
  label?: string;
};

/**
 * Native <dialog> rendered in a portal so it never disappears when the part of the page that
 * opened it collapses or re-renders (audit U22). The portal target is the `.app` root, not
 * document.body: shared styles are written as `.app …`, so content outside it lost its styles
 * (Stage 3 evaluation, X1). Falls back to body when rendered without the app shell (unit tests).
 */
export function Modal({ open, title, onClose, children, footer, busy = false, className, closeLabel = "Close", variant = "modal", label }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);
  if (!open) return null;
  return createPortal(
    <dialog
      ref={ref}
      className={cn("ui-modal", variant === "drawer" && "ui-drawer", className)}
      aria-labelledby={label ? undefined : titleId}
      aria-label={label}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    >
      <div className="ui-modal-inner">
        <div className="ui-modal-header">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" aria-label={closeLabel} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></Button>
        </div>
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </dialog>,
    document.querySelector<HTMLElement>(".app") ?? document.body,
  );
}

export function Drawer(props: Omit<ModalProps, "variant">) {
  return <Modal {...props} variant="drawer" />;
}
