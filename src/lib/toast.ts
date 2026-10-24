import { Toast } from "@base-ui/react/toast";

/**
 * One toast queue for the whole workspace (design system step 4c). Components call
 * `notify(...)` after an action succeeds that has no message of its own on the page;
 * `<Toaster />` in the workspace layout renders the queue.
 */
export const toastManager = Toast.createToastManager();

export type ToastTone = "success" | "error";

export function notify(title: string, options: { description?: string; tone?: ToastTone } = {}) {
  toastManager.add({
    title,
    description: options.description,
    type: options.tone ?? "success",
    // Errors stay longer: they usually need reading. Hovering or focusing pauses either.
    timeout: options.tone === "error" ? 8000 : 5000,
    priority: options.tone === "error" ? "high" : "low",
  });
}
