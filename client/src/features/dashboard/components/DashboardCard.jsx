/** One card on a dashboard: a titled region. Each card handles its own loading, empty and error states. */
export function DashboardCard({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-background p-4">
      <h2 id={id} className="mb-2 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function CardMessage({ children }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
