import { useEffect, useId, useRef } from 'react';

/**
 * A modal with a labelled form inside. Escape and the Cancel button close it, and focus stays inside
 * while it is open (WCAG 2.1 AA). Used by the report, suspension and report-close forms.
 */
export function FormDialog({ title, onClose, children }) {
  const id = useId();
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-lg bg-background p-4 shadow-lg"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
