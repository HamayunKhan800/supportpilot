export function Forbidden({ what }: { what: string }) {
  return (
    <section aria-labelledby="forbidden-heading" className="flex flex-col gap-2">
      <h1 id="forbidden-heading" className="text-2xl font-semibold">
        Access denied
      </h1>
      <p className="text-muted-foreground">
        Your role in this workspace doesn&apos;t allow you to view {what}.
      </p>
    </section>
  );
}
