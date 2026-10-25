import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("dotenv/config", () => ({}));
vi.mock("resend", () => ({
    Resend: class {
        emails = { send: mocks.send };
    },
}));

import { sendIncidentEmail } from "./email.service.js";

const previousApiKey = process.env.RESEND_API_KEY;
const previousFromEmail = process.env.RESEND_FROM_EMAIL;

describe("sendIncidentEmail", () => {
    beforeEach(() => {
        process.env.RESEND_API_KEY = "test-only-resend-key";
        process.env.RESEND_FROM_EMAIL = "PulseWatch <alerts@example.com>";
        mocks.send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
    });

    afterEach(() => {
        if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = previousApiKey;
        if (previousFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
        else process.env.RESEND_FROM_EMAIL = previousFromEmail;
    });

    it("escapes user-controlled text in the HTML email body", async () => {
        await sendIncidentEmail(
            "owner@example.com",
            "<img src=x onerror=alert(1)>",
            "AVAILABILITY & PERFORMANCE",
            "<script>alert('x')</script>",
        );

        const payload = mocks.send.mock.calls[0]?.[0] as { html: string; from: string };
        expect(payload.from).toBe("PulseWatch <alerts@example.com>");
        expect(payload.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
        expect(payload.html).toContain("AVAILABILITY &amp; PERFORMANCE");
        expect(payload.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
        expect(payload.html).not.toContain("<script>");
    });
});
