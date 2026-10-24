"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { type Choice, ChoiceMenu } from "@/components/choice-menu";
import { Input } from "@/components/ui/input";
import { listHref, type Queue } from "@/lib/ticket-queue";
import { useProgressRouter } from "@/lib/use-progress-router";
import type { TicketPriority } from "@/server/modules/tickets/types";
import { PRIORITY_LABEL } from "./labels";
import { PriorityIcon } from "./ticket-bits";

// Listed here, not imported from the server module: a value import would pull the server's
// schema code (Zod, Drizzle) into the browser bundle. Types are erased, so they are fine.
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

/**
 * Inbox search and filters (design step 9.5). Filters are chips that apply the moment a value is
 * picked (no Apply button), like Linear's; each choice is a URL, so the back button, links and
 * the ticket page's previous/next keep working, and the cursor resets. Search applies on Enter;
 * the form is a plain GET form carrying the other filters, so it also works before hydration.
 */
export function InboxFilters({
  queue,
  categories,
  assignees,
  currentUserId,
  filtered,
}: {
  queue: Queue;
  categories: string[];
  assignees: { id: string; name: string }[];
  currentUserId: string;
  filtered: boolean;
}) {
  const router = useProgressRouter();
  const go = (change: Queue) => router.push(listHref(queue, { ...change, after: "" }));

  const priority: Choice[] = [
    { value: "", label: "Any priority" },
    ...PRIORITIES.map((p) => ({
      value: p,
      label: PRIORITY_LABEL[p],
      icon: <PriorityIcon priority={p} />,
    })),
  ];
  const category: Choice[] = [
    { value: "", label: "Any category" },
    ...categories.map((c) => ({ value: c, label: c })),
  ];
  const assignee: Choice[] = [
    { value: "", label: "Anyone" },
    { value: "me", label: "Assigned to me" },
    { value: "unassigned", label: "Unassigned" },
    ...assignees.filter((a) => a.id !== currentUserId).map((a) => ({ value: a.id, label: a.name })),
  ];
  const sort: Choice[] = [
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
  ];

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <form
        method="get"
        action="/app/tickets"
        role="search"
        aria-label="Filter tickets"
        className="relative lg:max-w-sm lg:flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          go({ q });
        }}
      >
        {(["view", "priority", "category", "assignee", "needsReview", "sort"] as const).map(
          (k) => queue[k] && <input key={k} type="hidden" name={k} value={queue[k]} />,
        )}
        <label htmlFor="filter-q" className="sr-only">
          Search
        </label>
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          id="filter-q"
          name="q"
          type="search"
          // A new key when the URL's search changes (e.g. Clear), so the field shows it.
          key={queue.q ?? ""}
          defaultValue={queue.q}
          maxLength={200}
          placeholder="Search: words, -exclude, or #12"
          className="h-8 pl-8"
        />
      </form>
      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          label="Priority"
          value={queue.priority}
          choices={priority}
          onChange={(v) => go({ priority: v })}
        />
        <FilterChip
          label="Category"
          value={queue.category}
          choices={category}
          onChange={(v) => go({ category: v })}
        />
        <FilterChip
          label="Assignee"
          value={queue.assignee}
          choices={assignee}
          onChange={(v) => go({ assignee: v })}
        />
        <ChoiceMenu
          variant="chip"
          label="Sort"
          value={queue.sort ?? "newest"}
          isDefault={!queue.sort || queue.sort === "newest"}
          choices={sort}
          onChange={(v) => go({ sort: v === "newest" ? "" : v })}
        />
        {filtered && (
          <Link
            href={listHref({ view: queue.view })}
            className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm transition-colors"
          >
            <X aria-hidden="true" className="size-3.5" />
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}

/** A filter chip; when set, an attached × clears it in one click. */
function FilterChip({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string | undefined;
  choices: Choice[];
  onChange: (value: string) => void;
}) {
  if (!value) {
    return (
      <ChoiceMenu variant="chip" label={label} value="" isDefault choices={choices} onChange={onChange} />
    );
  }
  return (
    <span className="inline-flex items-center">
      <ChoiceMenu
        variant="chip"
        label={label}
        value={value}
        choices={choices}
        onChange={onChange}
        triggerClassName="rounded-r-none"
      />
      <button
        type="button"
        onClick={() => onChange("")}
        className="bg-accent text-muted-foreground hover:text-foreground hover:bg-muted -ml-px inline-flex h-8 w-7 cursor-pointer items-center justify-center rounded-r-md border transition-colors"
      >
        <X aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Clear {label.toLowerCase()} filter</span>
      </button>
    </span>
  );
}
