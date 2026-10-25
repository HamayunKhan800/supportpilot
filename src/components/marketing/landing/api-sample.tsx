"use client";

import { Tabs } from "@base-ui/react/tabs";
import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { SlidingIndicator } from "@/components/sliding-indicator";
import { cn } from "@/lib/utils";

/**
 * One real endpoint three ways (design step 9.3): the JSON exchange, curl and TypeScript. Checked
 * against the code: POST /api/v1/portal/{slug}/tickets takes JSON only (415 otherwise), is public
 * (no cookie, so no origin check), may answer 429, and returns { trackingUrl } once with 201.
 */

const k = (t: string) => <span className="text-info-strong">{t}</span>;
const str = (t: string) => <span className="text-success-strong">{t}</span>;
const note = (t: string) => <span className="text-muted-foreground">{t}</span>;

const SAMPLES: { value: string; label: string; code: ReactNode }[] = [
  {
    value: "json",
    label: "Request",
    code: (
      <>
        {note("// Request body, validated with Zod\n")}
        {"{\n  "}
        {k('"name"')}: {str('"Priya Shah"')}
        {",\n  "}
        {k('"email"')}: {str('"priya@example.com"')}
        {",\n  "}
        {k('"subject"')}: {str('"Refund for my annual plan"')}
        {",\n  "}
        {k('"message"')}: {str('"My annual plan renewed 12 days ago…"')}
        {"\n}\n\n"}
        {note("// 201 Created\n")}
        {"{ "}
        {k('"trackingUrl"')}: {str('"https://…/t/9f2c…"')}
        {" }"}
      </>
    ),
  },
  {
    value: "curl",
    label: "curl",
    code: (
      <>
        {"curl -X POST "}
        {str('"$BASE_URL/api/v1/portal/nimbus/tickets"')}
        {" \\\n  -H "}
        {str('"Content-Type: application/json"')}
        {" \\\n  -d "}
        {str(`'{
    "name": "Priya Shah",
    "email": "priya@example.com",
    "subject": "Refund for my annual plan",
    "message": "My annual plan renewed 12 days ago…"
  }'`)}
        {"\n\n"}
        {note("# 201 Created\n")}
        {'{"trackingUrl":"https://…/t/9f2c…"}'}
      </>
    ),
  },
  {
    value: "ts",
    label: "TypeScript",
    code: (
      <>
        {k("const")} res = {k("await")} fetch({str("`${BASE_URL}/api/v1/portal/nimbus/tickets`")}
        {", {\n  method: "}
        {str('"POST"')}
        {",\n  headers: { "}
        {str('"Content-Type"')}: {str('"application/json"')}
        {" },\n  body: JSON.stringify({ name, email, subject, message }),\n});\n"}
        {k("if")} (res.status === 429) {k("throw")} {k("new")} Error({str('"Rate limited: try again later"')}
        );
        {"\n"}
        {k("const")} {"{ trackingUrl } = "}
        {k("await")} res.json(); {note("// shown once; only a hash is stored")}
      </>
    ),
  },
];

export function ApiSample() {
  return (
    <Tabs.Root
      defaultValue="json"
      data-theme="dark"
      data-spotlight
      className="land-band text-foreground land-shadow relative overflow-hidden rounded-xl border"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
        <span className="bg-success-subtle text-success-strong rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold">
          POST
        </span>
        <span className="text-muted-foreground min-w-0 truncate font-mono text-xs">
          /api/v1/portal/nimbus/tickets
        </span>
        <span className="text-muted-foreground ml-auto flex items-center gap-1.5 font-mono text-[11px]">
          <KeyRound aria-hidden="true" className="size-3.5 shrink-0" />
          public
        </span>
      </div>
      <Tabs.List aria-label="Code sample" className="group/ind relative flex gap-1 border-b px-2 pt-1.5">
        <SlidingIndicator variant="underline" className="bg-foreground -bottom-px" />
        {SAMPLES.map((s) => (
          <Tabs.Tab
            key={s.value}
            value={s.value}
            className={cn(
              "text-muted-foreground hover:text-foreground -mb-px min-h-8 cursor-pointer border-b-2 border-transparent px-2.5 text-xs font-medium transition-colors",
              "data-[active]:border-foreground data-[active]:text-foreground group-data-[ind-ready]/ind:data-[active]:border-transparent",
            )}
          >
            {s.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {SAMPLES.map((s) => (
        <Tabs.Panel key={s.value} value={s.value}>
          <pre className="min-h-[19.5rem] p-4 font-mono text-[12.5px] leading-6 break-words whitespace-pre-wrap">
            <code>{s.code}</code>
          </pre>
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
