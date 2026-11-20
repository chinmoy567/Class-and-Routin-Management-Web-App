/** One card on a dashboard: a titled region. Each card handles its own loading, empty and error states. */
export function DashboardCard({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card p-5">
      <h2 id={id} className="mb-3 text-xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function CardMessage({ children }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
