import { describe, expect, it } from "vitest";
import {
  ACCEPT,
  formatBytes,
  isInProgress,
  STATUS_CLASS,
  STATUS_LABEL,
  typeLabel,
} from "@/app/app/(workspace)/knowledge/labels";
import { KB_ALLOWED_EXTENSIONS } from "@/server/modules/kb/file-type";
import { KB_DOCUMENT_STATUSES, KB_MIME_TYPES } from "@/server/platform/db/schema";

describe("knowledge page labels", () => {
  it("the upload form accepts exactly the extensions the server allows", () => {
    expect(ACCEPT.split(",").sort()).toEqual([...KB_ALLOWED_EXTENSIONS].sort());
  });

  it("has a label and a colour for every status, and a name for every file type", () => {
    for (const s of KB_DOCUMENT_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_CLASS[s]).toBeTruthy();
    }
    expect(KB_MIME_TYPES.map(typeLabel)).toEqual(["Markdown", "Text", "PDF"]);
    expect(typeLabel("application/x-unknown")).toBe("application/x-unknown");
  });

  it("only queued and processing documents count as in progress", () => {
    expect(KB_DOCUMENT_STATUSES.filter(isInProgress)).toEqual(["pending", "processing"]);
  });

  it("formats sizes in B, KB and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
