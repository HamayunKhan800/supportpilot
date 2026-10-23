import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getReviewOverview } from "@/server/modules/eval-review/service";
import { requireAppWorkspace } from "../workspace-context";
import { loadOrNotFound } from "./load";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage() {
  await requireAppWorkspace();
  const sets = await loadOrNotFound(async () => getReviewOverview(await headers()));
  const total = sets.reduce((n, s) => n + s.total, 0);
  const reviewed = sets.reduce((n, s) => n + s.reviewed, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <p className="text-muted-foreground">
          The human check in the evaluation plan. The test data was written with AI help, so a person checks a
          sample of it. Your answers are exported to the repository and every ❌ gets fixed. Only reviewers
          listed in the server settings see this page.
        </p>
        <p className="text-sm" data-testid="review-total">
          {reviewed} of {total} checked
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {sets.map((s) => {
          const done = s.total > 0 && s.reviewed === s.total;
          const progress = `${s.reviewed} of ${s.total} checked`;
          const action = done ? "Look again" : s.reviewed > 0 ? "Continue" : "Start";
          return (
            <li key={s.set}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>{s.title}</h2>
                  </CardTitle>
                  <CardDescription>{s.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {s.total === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Nothing to check yet. This arrives with a later step.
                    </p>
                  ) : (
                    <>
                      {/* A native <meter>: no inline style, which the CSP forbids. */}
                      <meter
                        className="budget-meter"
                        aria-label={`${s.title}: ${progress}`}
                        min={0}
                        max={s.total}
                        value={s.reviewed}
                      >
                        {progress}
                      </meter>
                      <p className="text-sm">
                        {progress}
                        {s.reviewed > 0 ? ` · ${s.agreed} marked correct` : ""}
                      </p>
                      <Link
                        href={`/app/review/${s.set}`}
                        // The visible word first, then which set (WCAG 2.5.3 label in name).
                        aria-label={`${action}: ${s.title}`}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-medium sm:w-fit"
                      >
                        {action}
                      </Link>
                    </>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
