"use client";

import { useEffect, useRef, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField, TextareaField, useFocusFirstInvalid } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fieldErrors, postJson } from "@/lib/api-client";
import { LIMITS, MIN } from "@/server/modules/tickets/limits";

type Field = "name" | "email" | "subject" | "message";
type Errors = Partial<Record<Field | "form", string>>;

/** Quick checks for instant feedback. The server validates everything again. */
function validate(v: Record<Field, string>): Errors {
  const e: Errors = {};
  if (v.name.trim().length < MIN.name) e.name = "Enter your name.";
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (v.subject.trim().length < MIN.subject)
    e.subject = `Subject must be at least ${MIN.subject} characters.`;
  if (v.message.trim().length < MIN.message)
    e.message = `Message must be at least ${MIN.message} characters.`;
  return e;
}

export function PortalForm({ slug }: { slug: string }) {
  const [values, setValues] = useState<Record<Field, string>>({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [website, setWebsite] = useState(""); // honeypot (plan D7)
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const formRef = useFocusFirstInvalid(failedAttempts);

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const local = validate(values);
    setErrors(local);
    if (Object.keys(local).length) {
      setFailedAttempts((n) => n + 1);
      return;
    }
    setPending(true);
    const res = await postJson<{ trackingUrl: string }>(
      `/api/v1/portal/${encodeURIComponent(slug)}/tickets`,
      {
        ...values,
        website,
      },
    );
    setPending(false);
    if (res.ok) setTrackingUrl(res.data.trackingUrl);
    else {
      const fields = fieldErrors(res.problem);
      setErrors({ ...fields, form: res.message });
      // Field errors: focus the first field. Otherwise the form alert takes focus itself.
      if (Object.keys(fields).length) setFailedAttempts((n) => n + 1);
    }
  }

  if (trackingUrl) return <Submitted trackingUrl={trackingUrl} />;

  return (
    <Card>
      <CardContent>
        <form ref={formRef} method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormAlert message={errors.form ?? ""} />
          <Alert role="note">
            <AlertDescription>
              Please don&apos;t include passwords, payment card numbers or other sensitive personal data.
            </AlertDescription>
          </Alert>
          <FormField
            label="Your name"
            name="name"
            autoComplete="name"
            required
            maxLength={LIMITS.name}
            value={values.name}
            onChange={set("name")}
            error={errors.name}
          />
          <FormField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={LIMITS.email}
            value={values.email}
            onChange={set("email")}
            error={errors.email}
            hint="Used only to identify your request. We don't send email yet."
          />
          <FormField
            label="Subject"
            name="subject"
            required
            maxLength={LIMITS.subject}
            value={values.subject}
            onChange={set("subject")}
            error={errors.subject}
          />
          <TextareaField
            label="How can we help?"
            name="message"
            required
            rows={6}
            maxLength={LIMITS.message}
            value={values.message}
            onChange={set("message")}
            error={errors.message}
            hint="Plain text. Include steps to reproduce and any error messages."
          />
          {/* Honeypot: off-screen and skipped by keyboard and screen readers; bots tend to fill it. */}
          <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
            <label>
              Leave this field empty
              <input
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Sending…" : "Send request"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Submitted({ trackingUrl }: { trackingUrl: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"" | "copied" | "manual">("");

  // Move focus to the confirmation so screen-reader and keyboard users land on it.
  useEffect(() => headingRef.current?.focus(), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied("copied");
    } catch {
      // Clipboard API needs a secure context and permission; fall back to selecting the text.
      inputRef.current?.select();
      setCopied("manual");
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
          Request received
        </h2>
        <p>Use this private link to follow your request and reply to our team.</p>
        <Alert role="note" className="border-warning-border bg-warning-subtle text-warning-strong">
          <AlertDescription className="text-warning-strong">
            <strong>Save this link now.</strong> It&apos;s the only way to open your request, and we
            can&apos;t show it again. Anyone with the link can read the conversation, so don&apos;t share it.
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="tracking-link" className="sr-only">
            Your private tracking link
          </label>
          <Input
            ref={inputRef}
            id="tracking-link"
            readOnly
            value={trackingUrl}
            className="h-10 font-mono text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button type="button" variant="outline" size="lg" onClick={copy}>
            Copy link
          </Button>
        </div>
        <p role="status" className="text-muted-foreground text-sm">
          {copied === "copied" && "Link copied."}
          {copied === "manual" && "Copying isn't available here. The link is selected: copy it manually."}
        </p>
        <a
          href={trackingUrl}
          rel="noreferrer"
          className={buttonVariants({ size: "lg", className: "self-start" })}
        >
          Open my request
        </a>
      </CardContent>
    </Card>
  );
}
