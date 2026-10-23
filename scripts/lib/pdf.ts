import { createHash } from "node:crypto";

/**
 * Minimal PDF writer for tests and the eval corpus (scripts/lib/kb-corpus.ts). Generating fixtures in code (instead of committing binary
 * files) keeps them reviewable and reproducible, and lets tests build exactly the hostile
 * shapes they need: too many pages, no text layer, truncation, password protection.
 */

export interface PdfOptions {
  /** Text per page; each string is one line. Default: one page with one line. */
  pages?: string[][];
  /** Draw a filled rectangle instead of text on every page (a "scanned" PDF). */
  imageOnly?: boolean;
  /** Protect with a user password (Standard security handler, RC4 40-bit, R2). */
  userPassword?: string;
}

const enc = (s: string) => Buffer.from(s, "latin1");

/** Escapes a PDF literal string. */
const pdfString = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

function contentStream(lines: string[], imageOnly: boolean): string {
  if (imageOnly) return "0.2 0.4 0.8 rg 72 72 300 400 re f";
  const ops = lines.map((line, i) => (i === 0 ? `${pdfString(line)} Tj` : `T* ${pdfString(line)} Tj`));
  return `BT /F1 12 Tf 14 TL 72 740 Td ${ops.join(" ")} ET`;
}

// --- Standard security handler, revision 2 (PDF 1.7 spec §7.6.3.3, algorithms 2, 3, 4) ---

const PASSWORD_PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");

const padPassword = (pw: string) => Buffer.concat([enc(pw), PASSWORD_PAD]).subarray(0, 32);

/** RC4, implemented here because OpenSSL 3 only ships it in the legacy provider. */
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();

function encryptionValues(userPassword: string, fileId: Buffer, permissions: number) {
  const owner = rc4(md5(padPassword(`${userPassword}-owner`)).subarray(0, 5), padPassword(userPassword));
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const key = md5(padPassword(userPassword), owner, p, fileId).subarray(0, 5);
  return { owner, user: rc4(key, PASSWORD_PAD) };
}

export function buildPdf(opts: PdfOptions = {}): Buffer {
  const pages = opts.pages ?? [["Hello from a test PDF."]];
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object numbers

  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const lines of pages) {
    const stream = contentStream(lines, opts.imageOnly ?? false);
    const content = add(`<< /Length ${enc(stream).length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  const fileId = md5(enc(JSON.stringify(opts)));
  let encryptRef = "";
  if (opts.userPassword !== undefined) {
    const permissions = -44;
    const { owner, user } = encryptionValues(opts.userPassword, fileId, permissions);
    const obj = add(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> ` +
        `/U <${user.toString("hex")}> /P ${permissions} >>`,
    );
    encryptRef = ` /Encrypt ${obj} 0 R`;
  }

  const chunks: Buffer[] = [enc("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const b = enc(`${i + 1} 0 obj\n${body}\nendobj\n`);
    chunks.push(b);
    offset += b.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encryptRef} ` +
    `/ID [<${fileId.toString("hex")}> <${fileId.toString("hex")}>] >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(enc(xref));
  return Buffer.concat(chunks);
}

/** `count` pages, each with a short numbered line. */
export const manyPages = (count: number) =>
  buildPdf({ pages: Array.from({ length: count }, (_, i) => [`Page ${i + 1} text.`]) });
