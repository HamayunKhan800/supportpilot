/**
 * One group of settings: title and explanation on the left, controls on the right
 * (stacked on narrow screens). Groups are separated by a rule (design system step 4c).
 */
export function FormSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="grid grid-cols-1 gap-x-8 gap-y-4 border-t py-6 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </h3>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </div>
  );
}
