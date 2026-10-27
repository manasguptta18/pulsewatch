import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("dotenv/config", () => ({}));
vi.mock("resend", () => ({
    Resend: class {
        logError(...args: unknown[]) { console.error(...args); }
        emails = { send: (...args: unknown[]) => {
            this.logError("SDK raw error", { message: "sensitive provider response" });
            return mocks.send(...args);
        } };
    },
}));

import { EmailDeliveryError, sendIncidentEmail } from "./email.service.js";

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

    it("returns a confirmed provider delivery ID", async () => {
        await expect(sendIncidentEmail(
            "owner@example.com", "Public API", "AVAILABILITY", "Down",
        )).resolves.toEqual({ id: "email-1" });
    });

    it("uses the stable outbox ID as the provider idempotency key", async () => {
        await sendIncidentEmail(
            "owner@example.com", "Public API", "AVAILABILITY", "Down", 18,
        );
        expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ to: ["owner@example.com"] }),
            { idempotencyKey: "pulsewatch-outbox-18" },
        );
    });

    it("does not treat a response without a delivery ID as sent", async () => {
        mocks.send.mockResolvedValue({ data: null, error: null });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(sendIncidentEmail(
            "owner@example.com", "Public API", "AVAILABILITY", "Down",
        )).rejects.toMatchObject({ retryable: true });
        expect(errorLog).toHaveBeenCalledExactlyOnceWith(
            "Incident email provider returned no delivery confirmation",
        );
        errorLog.mockRestore();
    });

    it("fails without contacting the provider when the API key is missing", async () => {
        delete process.env.RESEND_API_KEY;
        await expect(sendIncidentEmail(
            "owner@example.com", "Public API", "AVAILABILITY", "Down",
        )).rejects.toMatchObject({ retryable: false });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it.each([
        [429, "rate_limit_exceeded", true],
        [503, "internal_server_error", true],
        [403, "invalid_access", false],
        [409, "concurrent_idempotent_requests", true],
        [409, "invalid_idempotent_request", false],
    ])("classifies provider status %i (%s) as retryable=%s", async (statusCode, name, retryable) => {
        mocks.send.mockResolvedValue({
            data: null,
            error: { name, statusCode, message: "sensitive detail" },
        });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(sendIncidentEmail(
            "owner@example.com", "Public API", "AVAILABILITY", "Down",
        )).rejects.toMatchObject({ retryable });
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("sensitive detail");
        errorLog.mockRestore();
    });

    it("reports a provider rejection category and status without logging its message", async () => {
        mocks.send.mockResolvedValue({
            data: null,
            error: {
                name: "validation_error",
                statusCode: 422,
                message: "sensitive recipient detail",
            },
        });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(sendIncidentEmail(
            "owner@example.com",
            "Public API",
            "AVAILABILITY",
            "Down",
        )).rejects.toMatchObject({ retryable: false });

        expect(errorLog).toHaveBeenCalledExactlyOnceWith(
            "Incident email provider rejected the send request",
            { providerError: "validation_error", providerStatusCode: 422, retryable: false },
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("sensitive recipient detail");
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("sensitive provider response");
        errorLog.mockRestore();
    });

    it("keeps unknown transport failures retryable and logs only safe error codes", async () => {
        mocks.send.mockRejectedValue(Object.assign(
            new Error("request detail with sensitive recipient data"),
            { code: "ENOTFOUND" },
        ));
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(sendIncidentEmail(
            "owner@example.com",
            "Public API",
            "AVAILABILITY",
            "Down",
        )).rejects.toMatchObject({ retryable: true });

        expect(errorLog).toHaveBeenCalledExactlyOnceWith(
            "Incident email request failed before provider confirmation",
            { errorName: "Error", errorCodes: ["ENOTFOUND"] },
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("sensitive recipient data");
        errorLog.mockRestore();
    });

    it("identifies a Resend transport failure without calling it a provider rejection", async () => {
        mocks.send.mockResolvedValue({
            data: null,
            error: {
                name: "application_error",
                statusCode: null,
                message: "Unable to fetch data. The request could not be resolved.",
            },
        });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(sendIncidentEmail(
            "owner@example.com",
            "Public API",
            "AVAILABILITY",
            "Down",
        )).rejects.toMatchObject({ retryable: true });

        expect(errorLog).toHaveBeenCalledExactlyOnceWith(
            "Incident email request did not receive an HTTP response",
            { providerError: "application_error", providerStatusCode: null, retryable: true },
        );
        errorLog.mockRestore();
    });
});
