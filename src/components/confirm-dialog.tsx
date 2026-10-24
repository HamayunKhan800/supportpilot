"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * A confirmation step before a destructive action (design system step 4c), replacing
 * `window.confirm`. Built on Base UI AlertDialog: focus is trapped, Escape cancels, and
 * focus starts on the safe choice.
 *
 * `onConfirm` returns an error message to keep the dialog open and show it, or nothing to
 * close. `focusAfterConfirm` names where focus goes when the trigger itself disappears
 * (e.g. the removed row); after a cancel, focus returns to the trigger.
 */
export function ConfirmDialog({
  trigger,
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  focusAfterConfirm,
  open: controlledOpen,
  onOpenChange,
}: {
  /** The trigger button, without children (e.g. `<Button variant="destructive" />`). Omit when controlled. */
  trigger?: React.ReactElement<Record<string, unknown>>;
  triggerLabel?: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<string | void>;
  focusAfterConfirm?: () => HTMLElement | null;
  /** Controlled mode: open from code (e.g. after choosing "Closed" in a select). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);

  async function confirm() {
    setPending(true);
    setError("");
    const message = await onConfirm();
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    confirmed.current = true;
    setOpen(false);
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (pending) return; // don't close half-way through the action
        if (next) {
          confirmed.current = false;
          setError("");
        }
        setOpen(next);
      }}
    >
      {trigger && <AlertDialog.Trigger render={trigger}>{triggerLabel}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="bg-background/70 fixed inset-0 z-50 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <AlertDialog.Popup
          initialFocus={cancelRef}
          finalFocus={() => (confirmed.current && focusAfterConfirm?.()) || true}
          className="glass text-popover-foreground fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-2xl transition-[opacity,scale] duration-150 outline-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
        >
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
            {description}
          </AlertDialog.Description>
          <p role="alert" className="text-destructive mt-3 text-sm empty:hidden">
            {error}
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close
              ref={cancelRef}
              disabled={pending}
              render={<Button variant="outline" size="lg" className="h-10" />}
            >
              {cancelLabel}
            </AlertDialog.Close>
            <Button variant="destructive" size="lg" className="h-10" disabled={pending} onClick={confirm}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
