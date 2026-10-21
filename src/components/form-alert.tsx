"use client";

import { useEffect, useRef } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Error/success message that is announced and receives focus when it appears. */
export function FormAlert({ message, tone = "error" }: { message: string; tone?: "error" | "success" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <Alert
      ref={ref}
      tabIndex={-1}
      role={tone === "error" ? "alert" : "status"}
      variant={tone === "error" ? "destructive" : "default"}
      className="focus-visible:ring-ring outline-none focus-visible:ring-2"
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
