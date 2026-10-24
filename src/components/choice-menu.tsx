"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, type Ref, useId } from "react";
import { cn } from "@/lib/utils";

export interface Choice {
  value: string;
  label: string;
  /** Shown before the label, in the trigger and the menu (a status ring, priority bars…). */
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * Pick one value from a menu (design step 9.5), the way Linear and Plain set properties and
 * filters. Base UI Menu with radio items: arrow keys, typeahead, Escape, and focus back on the
 * trigger. Two looks:
 * - "property": the field's name above a quiet row showing the value (ticket details);
 * - "chip": a compact "Name: value" button (inbox filters), highlighted when not the default.
 * The trigger's accessible name is "<label> <value>", so it is found by its label. The popup is
 * positioned from JavaScript once open, which the strict CSP allows (no inline styles in HTML).
 */
export function ChoiceMenu({
  label,
  value,
  choices,
  onChange,
  variant = "property",
  status,
  describedBy,
  triggerRef,
  isDefault,
  triggerClassName,
}: {
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  variant?: "property" | "chip";
  /** A short state next to a property's name, e.g. "Saving…". */
  status?: string;
  describedBy?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  /** Chips: true when the value is the "any" default, so the chip stays quiet. */
  isDefault?: boolean;
  triggerClassName?: string;
}) {
  const id = useId();
  const current = choices.find((c) => c.value === value);
  const shown = current?.label ?? value;
  const Wrap = variant === "property" ? "div" : "span";

  const trigger =
    variant === "chip" ? (
      <Menu.Trigger
        ref={triggerRef}
        aria-labelledby={`${id}-label ${id}-value`}
        className={cn(
          "hover:bg-muted data-[popup-open]:bg-muted inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm whitespace-nowrap transition-colors",
          isDefault ? "text-muted-foreground border-dashed" : "bg-accent text-foreground",
          triggerClassName,
        )}
      >
        <span id={`${id}-label`} className={cn(!isDefault && "text-muted-foreground")}>
          {label}
          {!isDefault && ":"}
        </span>
        <span id={`${id}-value`} className={cn(isDefault && "sr-only")}>
          {shown}
        </span>
        <ChevronDown aria-hidden="true" className="text-muted-foreground size-3.5" />
      </Menu.Trigger>
    ) : (
      <Menu.Trigger
        ref={triggerRef}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-describedby={describedBy}
        className="group hover:bg-muted data-[popup-open]:bg-muted -mx-2 flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm transition-colors"
      >
        {current?.icon && (
          <span aria-hidden="true" className="flex w-4 shrink-0 items-center justify-center">
            {current.icon}
          </span>
        )}
        <span id={`${id}-value`} className="min-w-0 flex-1 truncate">
          {shown}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[popup-open]:opacity-100"
        />
      </Menu.Trigger>
    );

  return (
    <Wrap className={cn(variant === "property" ? "flex flex-col gap-1" : "inline-flex")}>
      {variant === "property" && (
        <div className="flex items-center justify-between gap-2">
          <span id={`${id}-label`} className="text-muted-foreground text-xs font-medium">
            {label}
          </span>
          <span aria-hidden="true" className="text-muted-foreground text-xs">
            {status}
          </span>
        </div>
      )}
      <Menu.Root>
        {trigger}
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={4} className="z-[60] outline-none">
            <Menu.Popup className="bg-popover text-popover-foreground max-h-[min(20rem,var(--available-height))] min-w-[max(var(--anchor-width),11rem)] origin-[var(--transform-origin)] overflow-y-auto rounded-lg border p-1 shadow-lg transition-[opacity,scale] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
              <Menu.RadioGroup value={value} onValueChange={(v) => v !== value && onChange(String(v))}>
                <Menu.GroupLabel className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs font-medium">
                  {label}
                </Menu.GroupLabel>
                {choices.map((c) => (
                  <Menu.RadioItem
                    key={c.value}
                    value={c.value}
                    label={c.label}
                    disabled={c.disabled}
                    closeOnClick
                    className="data-[highlighted]:bg-accent flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                  >
                    {c.icon && (
                      <span aria-hidden="true" className="flex w-4 shrink-0 items-center justify-center">
                        {c.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <Menu.RadioItemIndicator className="ml-2">
                      <Check aria-hidden="true" className="size-4" />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </Wrap>
  );
}
