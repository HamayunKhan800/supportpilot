"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A password input with the help people expect (design step 9.4):
 * - Show/Hide: a toggle button. Its name is "Show" (pressed or not) rather than "Show password",
 *   so it never competes with the field for the label "Password".
 * - A Caps Lock notice while typing with Caps Lock on, tied to the field with aria-describedby.
 * - Optionally (sign-up) a length meter against the real minimum. It measures length only and
 *   says so: the policy is length plus a breached-password check on the server, not "strength".
 * - An error after leaving the field, if it's too short (sign-up only).
 */
export function PasswordField({
  label = "Password",
  name = "password",
  autoComplete,
  minLength,
  maxLength,
  meter = false,
  hint,
  error: serverError,
}: {
  label?: string;
  name?: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  maxLength?: number;
  /** Show a length meter and check the length on blur (sign-up). */
  meter?: boolean;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const [touched, setTouched] = useState(false);

  const min = minLength ?? 0;
  const short = meter && value.length > 0 && value.length < min;
  const error = serverError || (touched && short ? `Use at least ${min} characters.` : "");
  const describedBy = [
    hint && `${id}-hint`,
    meter && `${id}-meter`,
    caps && `${id}-caps`,
    error && `${id}-error`,
  ]
    .filter(Boolean)
    .join(" ");
  const filled = min ? Math.min(1, value.length / min) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={maxLength}
          value={value}
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (touched && e.target.value.length >= min) setTouched(false);
          }}
          onKeyDown={(e) => setCaps(e.getModifierState("CapsLock"))}
          onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
          onBlur={() => {
            setCaps(false);
            if (value) setTouched(true);
          }}
          className="h-10 pr-16"
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted absolute top-1/2 right-1.5 h-7 min-w-12 -translate-y-1/2 cursor-pointer rounded-md px-2 text-xs font-medium transition-colors"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {meter && (
        <div id={`${id}-meter`} className="flex items-center gap-2.5">
          <span aria-hidden="true" className="bg-muted h-1 flex-1 overflow-hidden rounded-full">
            <span
              className={cn(
                "block h-full origin-left rounded-full transition-[scale,background-color] duration-200 ease-out",
                filled >= 1 ? "bg-success-strong" : "bg-foreground/60",
                METER_STEPS[Math.round(filled * 10)],
              )}
            />
          </span>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {value.length >= min ? "Long enough" : `${value.length} of ${min} characters`}
          </span>
        </div>
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {caps && (
        <p id={`${id}-caps`} className="text-warning-strong text-sm">
          Caps Lock is on.
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/** Width in tenths, as classes: the CSP allows no inline styles. */
const METER_STEPS = [
  "scale-x-0",
  "scale-x-10",
  "scale-x-20",
  "scale-x-30",
  "scale-x-40",
  "scale-x-50",
  "scale-x-60",
  "scale-x-70",
  "scale-x-80",
  "scale-x-90",
  "scale-x-100",
];
