"use client";

import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface WorkflowStep {
  value: string;
  title: string;
  body: string;
  icon: ReactNode;
  scene: ReactNode;
}

/**
 * The "how it works" showcase: one tab per stage of a ticket, each with its own product scene.
 * Base UI Tabs gives the ARIA tab pattern (arrow keys, Home/End, roving focus); hidden panels
 * unmount, so a scene's short entrance replays when its tab is chosen. No Tabs.Indicator: it
 * positions itself with inline styles, which the CSP does not allow.
 */
export function WorkflowTabs({ steps, label }: { steps: WorkflowStep[]; label: string }) {
  return (
    <Tabs.Root
      defaultValue={steps[0]!.value}
      orientation="vertical"
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-10"
    >
      <Tabs.List aria-label={label} className="grid grid-cols-2 gap-2 lg:flex lg:flex-col">
        {steps.map((s) => (
          <Tabs.Tab
            key={s.value}
            value={s.value}
            className={cn(
              "group text-muted-foreground flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-transparent p-3 text-left transition-colors lg:p-4",
              "hover:bg-muted/60 hover:text-foreground",
              "data-[active]:bg-card data-[active]:text-foreground data-[active]:border-border data-[active]:shadow-[0_1px_2px_oklch(0_0_0/0.06),0_8px_24px_-12px_oklch(0_0_0/0.22)]",
            )}
          >
            <span className="bg-background group-data-[active]:text-foreground mt-0.5 hidden size-7 shrink-0 items-center justify-center rounded-md border sm:flex [&_svg]:size-3.5">
              {s.icon}
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{s.title}</span>
              <span className="text-muted-foreground hidden text-sm leading-relaxed lg:group-data-[active]:block">
                {s.body}
              </span>
            </span>
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {steps.map((s) => (
        <Tabs.Panel key={s.value} value={s.value} className="flex flex-col gap-4 rounded-2xl">
          <p className="text-muted-foreground text-sm leading-relaxed lg:hidden">{s.body}</p>
          {s.scene}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
