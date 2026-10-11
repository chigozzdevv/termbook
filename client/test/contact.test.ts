import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage } from "../src/features/contact/api";
import { schema } from "../src/features/contact/schema";
import { ApiError } from "../src/lib/api";

const values = {
  name: "Ada",
  email: "ada@example.com",
  reason: "App integration" as const,
  project: "Example",
  message: "We want to integrate our app.",
};
const submission = "4aa447d6-8c72-4c8d-a7cf-e888b94370ab";
afterEach(() => vi.unstubAllGlobals());

describe("Contact form", () => {
  it("trims the form and permits an empty optional project", () => {
    expect(
      schema.parse({ ...values, name: " Ada ", email: " ada@example.com ", project: "" }),
    ).toEqual({ ...values, project: "" });
  });

  it.each([
    { name: "  " },
    { email: "invalid" },
    { reason: "Invalid" },
    { message: "  " },
    { message: "a".repeat(1201) },
    { project: "a".repeat(201) },
  ])("rejects invalid form details: %j", (invalid) => {
    expect(schema.safeParse({ ...values, ...invalid }).success).toBe(false);
  });

  it("calls the existing API with the submission ID", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await sendMessage(values, submission);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3001/contact");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ ...values, submission_id: submission });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([400, 429, 502, 503])("does not treat HTTP %i as success", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await expect(sendMessage(values, submission)).rejects.toEqual(new ApiError(status));
  });

  it("requires the server's explicit acceptance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"ok":false}', { status: 200 })),
    );
    await expect(sendMessage(values, submission)).rejects.toThrow();
  });

  it("propagates network failure for retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(sendMessage(values, submission)).rejects.toThrow("Failed to fetch");
  });
});
