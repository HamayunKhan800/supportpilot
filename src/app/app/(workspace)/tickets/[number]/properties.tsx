"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { patchJson } from "@/lib/api-client";
import { canAgentTransition } from "@/server/modules/tickets/lifecycle";
import type { TicketPriority, TicketStatus } from "@/server/modules/tickets/types";
import { PRIORITY_LABEL, selectClass, STATUS_LABEL } from "../labels";

const STATUSES: TicketStatus[] = ["open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

interface Props {
  ticket: {
    id: string;
    version: number;
    status: TicketStatus;
    priority: TicketPriority;
    category: string | null;
    assigneeId: string | null;
  };
  assignees: { id: string; name: string }[];
  categories: string[];
  currentUserId: string;
}

type Values = { status: TicketStatus; priority: TicketPriority; category: string; assigneeId: string };

/**
 * Status, priority, category and assignee. Sends only changed fields plus the version
 * the agent was looking at; a concurrent edit returns 409 instead of being overwritten.
 */
export function TicketProperties({ ticket, assignees, categories, currentUserId }: Props) {
  const router = useRouter();
  const id = useId();
  const initial: Values = {
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category ?? "",
    assigneeId: ticket.assigneeId ?? "",
  };
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);

  const changed = (Object.keys(values) as (keyof Values)[]).filter((k) => values[k] !== initial[k]);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!changed.length) return;
    const patch: Record<string, unknown> = { version: ticket.version };
    for (const k of changed) {
      patch[k] = (k === "category" || k === "assigneeId") && values[k] === "" ? null : values[k];
    }
    setPending(true);
    setError("");
    const res = await patchJson(`/api/v1/tickets/${ticket.id}`, patch);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      setConflict(res.problem.status === 409);
      return;
    }
    router.refresh(); // the page re-renders with the new version (and remounts this panel)
  }

  const closed = ticket.status === "closed";
  // A category removed from settings can still be on old tickets: keep it selectable.
  const categoryOptions =
    ticket.category && !categories.includes(ticket.category) ? [...categories, ticket.category] : categories;

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>
          <h2>Details</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
          <FormAlert message={error} />
          {conflict && (
            <Button type="button" variant="outline" onClick={() => router.refresh()}>
              Load latest version
            </Button>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-status`}>Status</Label>
            <select
              id={`${id}-status`}
              value={values.status}
              onChange={set("status")}
              className={selectClass}
              aria-describedby={closed ? `${id}-closed` : undefined}
            >
              {STATUSES.map((s) => (
                <option
                  key={s}
                  value={s}
                  disabled={s !== ticket.status && !canAgentTransition(ticket.status, s)}
                >
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {closed && (
              <p id={`${id}-closed`} className="text-muted-foreground text-sm">
                Closed requests are final.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-priority`}>Priority</Label>
            <select
              id={`${id}-priority`}
              value={values.priority}
              onChange={set("priority")}
              className={selectClass}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-category`}>Category</Label>
            <select
              id={`${id}-category`}
              value={values.category}
              onChange={set("category")}
              className={selectClass}
            >
              <option value="">None</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-assignee`}>Assignee</Label>
            <select
              id={`${id}-assignee`}
              value={values.assigneeId}
              onChange={set("assigneeId")}
              className={selectClass}
            >
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id === currentUserId ? `${a.name} (you)` : a.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending || changed.length === 0}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
