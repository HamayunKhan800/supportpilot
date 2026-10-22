import { useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface FieldText {
  label: string;
  hint?: string;
  error?: string;
}

/** ids for the label, hint and error, wired to aria-describedby (WCAG 1.3.1, 3.3.1). */
function useFieldIds({ hint, error }: Pick<FieldText, "hint" | "error">) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return {
    id,
    hintId,
    errorId,
    a11y: {
      "aria-invalid": error ? true : undefined,
      "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
    },
  };
}

function FieldMessages({
  hint,
  error,
  hintId,
  errorId,
}: Pick<FieldText, "hint" | "error"> & { hintId?: string; errorId?: string }) {
  return (
    <>
      {hint && (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </>
  );
}

type FieldProps = Omit<React.ComponentProps<typeof Input>, "id"> & FieldText;

/** Labelled input with hint and error. */
export function FormField({ label, hint, error, ...inputProps }: FieldProps) {
  const { id, hintId, errorId, a11y } = useFieldIds({ hint, error });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...a11y} className="h-10" {...inputProps} />
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  );
}

type TextareaFieldProps = Omit<React.ComponentProps<typeof Textarea>, "id"> & FieldText;

/** Labelled multi-line text with hint and error. */
export function TextareaField({ label, hint, error, ...props }: TextareaFieldProps) {
  const { id, hintId, errorId, a11y } = useFieldIds({ hint, error });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} {...a11y} {...props} />
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  );
}

/**
 * After a failed submit, moves focus to the first invalid field so keyboard and
 * screen-reader users land on the problem (WCAG 3.3.1). Bump `attempt` on each failure.
 */
export function useFocusFirstInvalid(attempt: number) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);
  return formRef;
}
