"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { SHELL_SHORTCUTS } from "@/lib/shortcuts";
import { ModKey } from "./parts";

/** The "?" sheet: every keyboard shortcut that exists, with the keys to press. */
export function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="bg-background/70 fixed inset-0 z-50 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup className="bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-2xl transition-[opacity,scale] duration-150 outline-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">Keyboard shortcuts</Dialog.Title>
              <Dialog.Description className="text-muted-foreground mt-1 text-sm">
                Single-key shortcuts are paused while you type in a field.
              </Dialog.Description>
            </div>
            <Dialog.Close className="hover:bg-accent text-muted-foreground hover:text-foreground focus-visible:outline-ring -m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md focus-visible:outline-2">
              <X aria-hidden="true" className="size-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>
          <ul className="mt-4 divide-y">
            {SHELL_SHORTCUTS.map(({ keys, label }) => (
              <li key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span>{label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {keys.map((key, i) => (
                    <span key={key} className="inline-flex items-center gap-1">
                      {i > 0 && (
                        <span aria-hidden="true" className="text-muted-foreground text-xs">
                          +
                        </span>
                      )}
                      {key === "Mod" ? <ModKey /> : <Kbd>{key}</Kbd>}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
