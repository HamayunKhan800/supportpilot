import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmailSender, EmailSendError, sendInBackground } from "@/server/platform/email";
import { canReadOutbox, clearOutbox, createOutboxSender, readOutbox } from "@/server/platform/email/outbox";
import { createResendSender } from "@/server/platform/email/resend";
import { logger } from "@/server/platform/logger";

const message = { to: "Person@Example.com", subject: "Hello", text: "Body" };

afterEach(() => {
  clearOutbox();
  vi.restoreAllMocks();
});

describe("createEmailSender", () => {
  it("returns no sender when email is not configured (features stay off)", () => {
    expect(createEmailSender({})).toBeNull();
  });

  it("picks the implementation from EMAIL_PROVIDER", async () => {
    const outbox = createEmailSender({ EMAIL_PROVIDER: "outbox", EMAIL_FROM: "x <a@b.c>" });
    await outbox!.send(message);
    expect(readOutbox()).toHaveLength(1);
    expect(
      createEmailSender({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "a@b.c", RESEND_API_KEY: "k" }),
    ).not.toBeNull();
  });
});

describe("Resend sender", () => {
  it("posts plain text to the Resend API with the key as a bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await createResendSender({ apiKey: "re_test", from: "SP <no-reply@example.com>", fetch: fetchMock }).send(
      message,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "SP <no-reply@example.com>",
      to: ["Person@Example.com"],
      subject: "Hello",
      text: "Body",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("error"); // never follows a redirect off the fixed host (M7-16)
  });

  it("reports a rejected message with the status only (the body can echo the address)", async () => {
    const fetchMock = vi.fn(async () => new Response('{"message":"to Person@Example.com"}', { status: 403 }));
    const err = await createResendSender({ apiKey: "k", from: "a@b.c", fetch: fetchMock })
      .send(message)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as EmailSendError).status).toBe(403);
    expect((err as Error).message).not.toContain("Person");
  });

  it("reports a network failure or timeout without a status", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const err = await createResendSender({ apiKey: "k", from: "a@b.c", fetch: fetchMock })
      .send(message)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as EmailSendError).status).toBeUndefined();
  });
});

describe("outbox", () => {
  it("returns messages newest first, filtered by recipient case-insensitively", async () => {
    const box = createOutboxSender();
    await box.send(message);
    await box.send({ ...message, subject: "Second" });
    await box.send({ ...message, to: "other@example.com" });
    const mine = readOutbox("person@example.com");
    expect(mine.map((m) => m.subject)).toEqual(["Second", "Hello"]);
    expect(mine[0]?.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readOutbox()).toHaveLength(3);
  });

  it("keeps only the newest 50 messages", async () => {
    const box = createOutboxSender();
    for (let i = 0; i < 55; i++) await box.send({ ...message, subject: `#${i}` });
    const all = readOutbox();
    expect(all).toHaveLength(50);
    expect(all[0]?.subject).toBe("#54");
    expect(all.at(-1)?.subject).toBe("#5");
  });
});

describe("canReadOutbox", () => {
  const token = "t".repeat(40);
  it("allows only the outbox provider with the exact token", () => {
    expect(canReadOutbox({ EMAIL_PROVIDER: "outbox", EMAIL_OUTBOX_TOKEN: token }, token)).toBe(true);
    expect(canReadOutbox({ EMAIL_PROVIDER: "outbox", EMAIL_OUTBOX_TOKEN: token }, `${token}x`)).toBe(false);
    expect(canReadOutbox({ EMAIL_PROVIDER: "outbox", EMAIL_OUTBOX_TOKEN: token }, null)).toBe(false);
    expect(canReadOutbox({ EMAIL_PROVIDER: "resend", EMAIL_OUTBOX_TOKEN: token }, token)).toBe(false);
    expect(canReadOutbox({}, token)).toBe(false);
  });
});

describe("sendInBackground", () => {
  it("does not wait for delivery and logs failures without the address", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    let finish!: () => void;
    const sender = {
      send: vi.fn(
        () =>
          new Promise<void>((_, reject) => {
            finish = () => reject(new EmailSendError("rejected", 422));
          }),
      ),
    };
    expect(sendInBackground(sender, message, "password-reset")).toBeUndefined();
    expect(sender.send).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain("email.send_failed");
    expect(logged).toContain("password-reset");
    expect(logged).toContain("422");
    expect(logged).not.toContain("Person");
  });
});
