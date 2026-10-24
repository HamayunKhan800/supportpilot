"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { patchJson } from "@/lib/api-client";
import { notify } from "@/lib/toast";
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
type Field = keyof Values;

const FIELD_LABEL: Record<Field, string> = {
  status: "Status",
  priority: "Priority",
  category: "Category",
  assigneeId: "Assignee",
};

/**
 * Status, priority, category and assignee (design step 8.3: instant changes).
 *
 * A change shows at once and saves in the background, like Linear: no Save button. Saves run
 * one after another, each sending the version the previous one returned, so quick successive
 * changes never trip the concurrency check; a change by someone else still returns 409. A
 * refused change is put back and explained here. Each saved change offers Undo, except closing,
 * which is final and therefore asks first.
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
  const [saving, setSaving] = useState<Field | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const version = useRef(ticket.version);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const statusRef = useRef<HTMLSelectElement>(null);
  // The newest version this panel knows about. A higher version in the props means someone
  // else changed the ticket (another agent, accepted triage, a customer reply reopening it):
  // adopt the server's values. Our own saves raise it first, so they never reset the panel.
  const [knownVersion, setKnownVersion] = useState(ticket.version);
  if (ticket.version > knownVersion) {
    setKnownVersion(ticket.version);
    setValues(initial);
    setError("");
    setConflict(false);
  }
  useEffect(() => {
    if (ticket.version > version.current) version.current = ticket.version;
  }, [ticket.version]);

  const valueLabel = (field: Field, value: string) =>
    field === "status"
      ? STATUS_LABEL[value as TicketStatus]
      : field === "priority"
        ? PRIORITY_LABEL[value as TicketPriority]
        : field === "category"
          ? value || "None"
          : (assignees.find((a) => a.id === value)?.name ?? "Unassigned");

  /** Show `value` now, save it, and put `previous` back if the server refuses. */
  function save(field: Field, value: string, previous: string, mode: "change" | "undo" = "change") {
    setValues((v) => ({ ...v, [field]: value }));
    setError("");
    setConflict(false);
    const run = queue.current.then(async () => {
      setSaving(field);
      const apiValue = (field === "category" || field === "assigneeId") && value === "" ? null : value;
      const res = await patchJson<{ version: number }>(`/api/v1/tickets/${ticket.id}`, {
        version: version.current,
        [field]: apiValue,
      });
      setSaving(null);
      if (!res.ok) {
        setValues((v) => ({ ...v, [field]: previous }));
        setError(res.message);
        setConflict(res.problem.status === 409);
        return;
      }
      version.current = res.data.version;
      setKnownVersion((v) => Math.max(v, res.data.version));
      const final = field === "status" && value === "closed";
      if (mode === "undo")
        notify("Change undone", {
          description: `${FIELD_LABEL[field]} is back to ${valueLabel(field, value)}.`,
        });
      else
        notify(`${FIELD_LABEL[field]} changed to ${valueLabel(field, value)}`, {
          action: final ? undefined : { label: "Undo", onClick: () => save(field, previous, value, "undo") },
        });
      // The header, conversation and inbox counts re-render; this panel keeps its own state.
      router.refresh();
    });
    queue.current = run;
    return run;
  }

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const field = e.target.name as Field;
    const value = e.target.value;
    if (field === "status" && value === "closed") {
      setConfirmClose(true); // final: ask first, change nothing yet
      return;
    }
    save(field, value, values[field]);
  }

  const closed = values.status === "closed";
  // A category removed from settings can still be on old tickets: keep it selectable.
  const categoryOptions =
    ticket.category && !categories.includes(ticket.category) ? [...categories, ticket.category] : categories;

  const fieldLabel = (field: Field, htmlFor: string) => (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={htmlFor}>{FIELD_LABEL[field]}</Label>
      <span aria-hidden="true" className="text-muted-foreground text-xs">
        {saving === field ? "Saving…" : ""}
      </span>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Details</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">Changes save as you make them.</p>
          <FormAlert message={error} />
          {conflict && (
            <Button type="button" variant="outline" onClick={() => router.refresh()}>
              Load latest version
            </Button>
          )}
          <div className="flex flex-col gap-1.5">
            {fieldLabel("status", `${id}-status`)}
            <select
              ref={statusRef}
              id={`${id}-status`}
              value={values.status}
              name="status"
              onChange={onChange}
              className={selectClass}
              aria-describedby={closed ? `${id}-closed` : undefined}
            >
              {STATUSES.map((s) => (
                <option
                  key={s}
                  value={s}
                  disabled={s !== values.status && !canAgentTransition(values.status, s)}
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
            {fieldLabel("priority", `${id}-priority`)}
            <select
              id={`${id}-priority`}
              value={values.priority}
              name="priority"
              onChange={onChange}
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
            {fieldLabel("category", `${id}-category`)}
            <select
              id={`${id}-category`}
              value={values.category}
              name="category"
              onChange={onChange}
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
            {fieldLabel("assigneeId", `${id}-assignee`)}
            <select
              id={`${id}-assignee`}
              value={values.assigneeId}
              name="assigneeId"
              onChange={onChange}
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
        </div>
        <ConfirmDialog
          open={confirmClose}
          onOpenChange={setConfirmClose}
          title="Close this request?"
          description="Closed requests are final: the customer can't reply any more and it can't be reopened. Internal notes stay possible."
          confirmLabel="Close request"
          onConfirm={async () => {
            void save("status", "closed", values.status);
          }}
          focusAfterConfirm={() => statusRef.current}
        />
      </CardContent>
    </Card>
  );
}
