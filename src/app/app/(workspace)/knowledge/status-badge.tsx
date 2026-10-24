import { CircleAlert, CircleCheck, Clock, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type DocumentStatus, STATUS_CLASS, STATUS_LABEL } from "./labels";

const ICON = { pending: Clock, processing: LoaderCircle, ready: CircleCheck, failed: CircleAlert } as const;

/** Ingestion status: icon + label (the label carries the meaning; colour only repeats it). */
export function DocumentStatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const Icon = ICON[status];
  return (
    <Badge variant="outline" className={cn("gap-1", STATUS_CLASS[status], className)}>
      <Icon aria-hidden="true" className={cn(status === "processing" && "motion-safe:animate-spin")} />
      <span className="sr-only">Status: </span>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
