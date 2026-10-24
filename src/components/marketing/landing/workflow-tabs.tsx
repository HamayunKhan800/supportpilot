"use client";

import { Tabs } from "@base-ui/react/tabs";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
 *
 * The tabs advance on their own (design step 9.3). The timer is the progress line itself: a CSS
 * animation on the active tab whose `animationend` moves to the next tab, so pausing is just
 * `animation-play-state` (on hover, on focus inside, and while the section is off screen) and no
 * JavaScript timer can drift from what is drawn. With reduced motion the line is not shown and
 * never ends, so nothing moves. Choosing a tab stops the tour for good: the visitor is in charge.
 */
export function WorkflowTabs({ steps, label }: { steps: WorkflowStep[]; label: string }) {
  const [value, setValue] = useState(steps[0]!.value);
  const [touring, setTouring] = useState(true);
  const [onScreen, setOnScreen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? false), {
      threshold: 0.35,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const next = () => {
    const i = steps.findIndex((s) => s.value === value);
    setValue(steps[(i + 1) % steps.length]!.value);
  };

  return (
    <Tabs.Root
      ref={root}
      value={value}
      onValueChange={(v: string) => {
        setValue(v);
        setTouring(false);
      }}
      orientation="vertical"
      className="land-tour grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-10"
    >
      <Tabs.List aria-label={label} className="grid grid-cols-2 gap-2 lg:flex lg:flex-col">
        {steps.map((s) => (
          <Tabs.Tab
            key={s.value}
            value={s.value}
            className={cn(
              "group text-muted-foreground relative flex min-h-11 cursor-pointer items-start gap-3 overflow-hidden rounded-xl border border-transparent p-3 text-left transition-colors lg:p-4",
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
            {touring && s.value === value && (
              <span
                aria-hidden="true"
                // The key restarts the line whenever the tab changes.
                key={value}
                data-paused={onScreen ? undefined : ""}
                onAnimationEnd={next}
                className="land-progress bg-foreground/70 absolute inset-x-3 bottom-0 h-0.5 rounded-full lg:inset-x-4"
              />
            )}
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
