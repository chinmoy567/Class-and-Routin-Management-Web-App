import { Input } from '@/components/ui/input.jsx';
import { t } from '@/lib/i18n';

/** A visible label, an input wired to react-hook-form, an optional hint and a translated error. */
export function TextField({ id, name, label, hint, error, register, type, ...inputProps }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...register(name)}
        {...inputProps}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {t(`auth.fields.${name}.error`)}
        </p>
      )}
    </div>
  );
}
