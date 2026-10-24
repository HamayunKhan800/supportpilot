import { Toast } from "@base-ui/react/toast";

/**
 * One toast queue for the whole workspace (design system step 4c, design step 8.2).
 * Components call `notify(...)` after an action whose result is not otherwise visible where
 * the person is looking: actions that already show a message on the page keep that message
 * instead (no duplicates). `<Toaster />` in the workspace layout renders the queue.
 */
export const toastManager = Toast.createToastManager();

/** success: an action worked · error: it didn't · info: something happened (live updates). */
export type ToastTone = "success" | "error" | "info";

export interface ToastAction {
  /** Short verb: "Undo", "Open", "Retry". */
  label: string;
  onClick: () => void;
}

export interface NotifyOptions {
  description?: string;
  tone?: ToastTone;
  action?: ToastAction;
}

/** Errors stay longer (they need reading); toasts with an action leave time to use it. */
export function toastTimeout(options: NotifyOptions): number {
  if (options.tone === "error") return 8000;
  return options.action ? 7000 : 5000;
}

export function notify(title: string, options: NotifyOptions = {}): string {
  const tone = options.tone ?? "success";
  const id: string = toastManager.add({
    title,
    description: options.description,
    type: tone,
    // Hovering or focusing a toast pauses its timer (Base UI).
    timeout: toastTimeout(options),
    priority: tone === "error" ? "high" : "low",
    actionProps: options.action && {
      children: options.action.label,
      onClick: () => {
        toastManager.close(id);
        options.action?.onClick();
      },
    },
  });
  return id;
}
