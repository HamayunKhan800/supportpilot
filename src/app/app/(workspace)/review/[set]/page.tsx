import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RUBRIC_RULE_IDS, RUBRIC_RULES } from "@/server/modules/eval/rubric";
import { getReviewItemPage } from "@/server/modules/eval-review/service";
import { requireAppWorkspace } from "../../workspace-context";
import { loadOrNotFound } from "../load";
import { VerdictForm } from "./verdict-form";

export const metadata: Metadata = { title: "Review" };

const linkClass = "hover:bg-muted inline-flex h-11 items-center gap-1 rounded-md px-3 text-sm";

export default async function ReviewSetPage({ params, searchParams }: PageProps<"/app/review/[set]">) {
  await requireAppWorkspace();
  const { set } = await params;
  const item = (await searchParams).item;
  const page = await loadOrNotFound(async () =>
    getReviewItemPage(await headers(), set, typeof item === "string" ? item : undefined),
  );
  const { content } = page.item;
  const progress = `${page.reviewed} of ${page.total} checked`;
  const href = (key: string) => `/app/review/${page.set}?item=${encodeURIComponent(key)}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/app/review"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          All reviews
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
        <p className="text-muted-foreground text-sm">{page.description}</p>
        <p className="text-sm" data-testid="review-position">
          Item {page.index} of {page.total} · {progress}
        </p>
        <meter className="budget-meter" aria-label={progress} min={0} max={page.total} value={page.reviewed}>
          {progress}
        </meter>
      </div>

      {page.set === "triage-labels" ? (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Priority rules (the first that matches wins)
          </summary>
          <ol className="mt-2 flex flex-col gap-1">
            {RUBRIC_RULE_IDS.map((id) => (
              <li key={id}>
                <span className="font-medium">
                  {id} · {RUBRIC_RULES[id].priority}:
                </span>{" "}
                {RUBRIC_RULES[id].summary}
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground mt-2">
            Urgency words alone don&apos;t raise a priority; what is at stake does. Category follows what the
            customer wants, not the words they use. The full rubric is docs/eval/triage-rubric.md in the
            repository.
          </p>
        </details>
      ) : null}

      <Card>
        <CardHeader>
          <p className="text-muted-foreground text-xs">{page.item.itemKey}</p>
          <CardTitle>
            {/* dir="auto": some items are in Arabic or Urdu, written right to left. */}
            <h2 dir="auto" className="text-lg leading-snug">
              {content.title}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl className="flex flex-col gap-3">
            {content.fields.map((f, i) => (
              <div key={`${f.label}-${i}`} className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {f.label}
                </dt>
                <dd>
                  {f.kind === "quote" ? (
                    <blockquote dir="auto" className="border-l-4 pl-3 text-sm whitespace-pre-wrap">
                      {f.value}
                    </blockquote>
                  ) : (
                    <span dir="auto" className="text-sm font-medium">
                      {f.value}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <VerdictForm
            key={`${page.item.id}-${page.item.contentHash}`}
            set={page.set}
            id={page.item.id}
            contentHash={page.item.contentHash}
            question={content.question}
            agreeLabel={content.agreeLabel}
            disagreeLabel={content.disagreeLabel}
            verdict={page.item.verdict}
            note={page.item.note}
          />
        </CardContent>
      </Card>

      <nav aria-label="Items in this set" className="flex justify-between gap-2">
        {page.prevKey ? (
          <Link href={href(page.prevKey)} className={linkClass}>
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </Link>
        ) : (
          <span />
        )}
        {page.nextKey ? (
          <Link href={href(page.nextKey)} className={linkClass}>
            Next
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
