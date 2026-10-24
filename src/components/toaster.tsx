"use client";

import { Toast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { toastManager } from "@/lib/toast";

/**
 * Renders the workspace toast queue (Base UI Toast). Toasts are announced politely (errors
 * assertively), pause while hovered or focused, and F6 moves focus into them. They stack in
 * normal flow, so no inline positioning styles are needed (the CSP allows none).
 */
export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="fixed inset-x-3 bottom-3 z-[60] flex flex-col-reverse gap-2 outline-none sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[22rem]">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => {
    const Icon = toast.type === "error" ? CircleAlert : toast.type === "info" ? Info : CircleCheck;
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        className="glass text-popover-foreground relative rounded-lg border shadow-lg transition-[opacity,translate] duration-200 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[limited]:hidden data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 motion-reduce:transition-none"
      >
        <Toast.Content className="flex items-start gap-3 py-3 pr-11 pl-3">
          <Icon
            aria-hidden="true"
            className={
              toast.type === "error"
                ? "text-danger-strong mt-0.5 size-4 shrink-0"
                : toast.type === "info"
                  ? "text-muted-foreground mt-0.5 size-4 shrink-0"
                  : "text-success-strong mt-0.5 size-4 shrink-0"
            }
          />
          <div className="min-w-0">
            <Toast.Title className="text-sm font-medium" />
            <Toast.Description className="text-muted-foreground mt-0.5 text-sm empty:hidden" />
            {toast.actionProps && (
              <Toast.Action className="border-border hover:bg-muted focus-visible:outline-ring mt-2 inline-flex h-7 items-center rounded-md border px-2.5 text-sm font-medium focus-visible:outline-2" />
            )}
          </div>
          <Toast.Close
            aria-label="Dismiss notification"
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-ring absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md focus-visible:outline-2"
          >
            <X aria-hidden="true" className="size-4" />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}
