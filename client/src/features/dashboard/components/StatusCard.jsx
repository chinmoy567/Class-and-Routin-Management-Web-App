import { statusText } from '@/features/routine/components/LiveStatusCard.jsx';

/** DSH-04, DSH-05, DSH-11: "In class / Free / Teaching" with its countdown, shown above the cards. */
export function StatusCard({ status }) {
  const text = statusText(status);
  if (!text) return null;
  return (
    <div className={`mb-4 rounded-lg p-4 ${text.accent}`}>
      <p className="text-base font-semibold">{text.headline}</p>
      {text.sub && <p className="mt-1 text-sm text-muted-foreground">{text.sub}</p>}
    </div>
  );
}
