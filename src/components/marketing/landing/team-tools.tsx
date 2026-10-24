import { BookOpen, CornerDownLeft, Inbox, Search, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Keys } from "./mock";

/**
 * The command palette with a search typed in, and the shortcuts around it. Results and keys are
 * the real ones (command-palette.tsx, src/lib/shortcuts.ts); the ticket number is demo data.
 */
export function PaletteScene() {
  const groups = [
    {
      heading: "Tickets",
      items: [
        { icon: Inbox, label: "Open ticket #128", hint: "", active: true },
        { icon: Search, label: "Search tickets for “128”", hint: "" },
      ],
    },
    {
      heading: "Go to",
      items: [
        { icon: Inbox, label: "Tickets", hint: "" },
        { icon: BookOpen, label: "Knowledge", hint: "" },
        { icon: Settings2, label: "AI settings", hint: "" },
      ],
    },
  ];
  return (
    <div aria-hidden="true" className="relative flex flex-col items-center gap-5 select-none">
      <div className="bg-popover text-popover-foreground land-shadow w-full max-w-md overflow-hidden rounded-xl border text-left text-[13px]">
        <div className="flex items-center gap-2 border-b px-3.5 py-3">
          <Search className="text-muted-foreground size-4" />
          <span>128</span>
          <span className="stream-caret -ml-1.5" />
          <span className="text-muted-foreground ml-auto">
            <Keys keys={["Esc"]} />
          </span>
        </div>
        <div className="flex flex-col gap-1 p-1.5">
          {groups.map((g) => (
            <div key={g.heading} className="flex flex-col">
              <span className="text-muted-foreground px-2 pt-1.5 pb-1 text-[11px] font-medium">
                {g.heading}
              </span>
              {g.items.map(({ icon: Icon, label, hint, active }) => (
                <span
                  key={label}
                  className={cn("flex h-8 items-center gap-2.5 rounded-md px-2", active && "bg-accent")}
                >
                  <Icon className="text-muted-foreground size-3.5" />
                  <span className="truncate">{label}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">{hint}</span>
                  {active && <CornerDownLeft className="text-muted-foreground size-3.5" />}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
        <span className="flex items-center gap-2">
          <Keys keys={["Ctrl", "K"]} /> Search or jump
        </span>
        <span className="flex items-center gap-2">
          <Keys keys={["J", "K"]} /> Next and previous ticket
        </span>
        <span className="flex items-center gap-2">
          <Keys keys={["?"]} /> All shortcuts
        </span>
      </div>
    </div>
  );
}
