import "dotenv/config";
import {Resend} from "resend";
import { safeErrorDetails } from "../lib/safe-error.js";

let resend: Resend | undefined;

export class EmailDeliveryError extends Error {
    constructor(readonly retryable: boolean) {
        super("Incident email delivery failed");
        this.name = "EmailDeliveryError";
    }
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character]!);
}

function isRetryableProviderFailure(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return true;
    const candidate = error as { name?: unknown; statusCode?: unknown; status?: unknown };
    if (candidate.name === "concurrent_idempotent_requests") return true;
    const status = typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : candidate.status;
    if (typeof status !== "number") return true;
    return status === 408 || status === 429 || (status >= 500 && status < 600);
}

const RESEND_ERROR_NAMES = new Set([
    "invalid_idempotency_key",
    "validation_error",
    "missing_api_key",
    "restricted_api_key",
    "invalid_api_key",
    "not_found",
    "method_not_allowed",
    "invalid_idempotent_request",
    "concurrent_idempotent_requests",
    "invalid_attachment",
    "invalid_from_address",
    "invalid_access",
    "invalid_parameter",
    "invalid_region",
    "missing_required_field",
    "monthly_quota_exceeded",
    "daily_quota_exceeded",
    "rate_limit_exceeded",
    "security_error",
    "application_error",
    "internal_server_error",
]);

function safeProviderErrorDetails(error: unknown) {
    if (typeof error !== "object" || error === null) return {};
    const candidate = error as { name?: unknown; statusCode?: unknown };
    return {
        ...(typeof candidate.name === "string" && RESEND_ERROR_NAMES.has(candidate.name)
            ? { providerError: candidate.name }
            : {}),
        ...(candidate.statusCode === null || (
            typeof candidate.statusCode === "number" &&
            Number.isInteger(candidate.statusCode) &&
            candidate.statusCode >= 100 &&
            candidate.statusCode <= 599
        ) ? { providerStatusCode: candidate.statusCode } : {}),
    };
}

function createResendClient(apiKey: string): Resend {
    const client = new Resend(apiKey);
    // The SDK writes the full provider response to console.error in non-
    // production environments. Override that private logger on this instance;
    // sendIncidentEmail emits only the bounded diagnostic fields above.
    Object.defineProperty(client, "logError", { value: () => undefined });
    return client;
}

export async function sendIncidentEmail(destination: string,
    monitorName: string,
    incidentType: string,
    reason: string,
    outboxId?: number,
){
    if (!process.env.RESEND_API_KEY) {
        throw new EmailDeliveryError(false);
    }
    resend ??= createResendClient(process.env.RESEND_API_KEY);

    const safeMonitorName = escapeHtml(monitorName);
    const safeIncidentType = escapeHtml(incidentType);
    const safeReason = escapeHtml(reason);
    const safeSubjectName = monitorName.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160);
    const sender = process.env.RESEND_FROM_EMAIL?.trim() || "PulseWatch <onboarding@resend.dev>";
    if (/[\r\n]/.test(sender)) throw new EmailDeliveryError(false);

    let result: Awaited<ReturnType<typeof resend.emails.send>>;
    try {
        result = await resend.emails.send({
            from: sender,
            to: [destination],
            subject:  `🚨 PulseWatch Alert: ${safeSubjectName}`,
            html: `
                <h2>PulseWatch Incident Alert</h2>

                <p><strong>Monitor:</strong> ${safeMonitorName}</p>

                <p><strong>Incident Type:</strong> ${safeIncidentType}</p>

                <p><strong>Reason:</strong> ${safeReason}</p>

                <p>
                    PulseWatch detected an issue with your monitored API.
                </p>
            `,
        }, outboxId === undefined
            ? undefined
            : { idempotencyKey: `pulsewatch-outbox-${outboxId}` });
    } catch (error) {
        console.error("Incident email request failed before provider confirmation", {
            ...safeErrorDetails(error),
        });
        throw new EmailDeliveryError(isRetryableProviderFailure(error));
    }

    const { data, error } = result;

    if (error) {
        // Provider messages can include recipient or request details. Log only
        // the bounded status and known error category needed for diagnosis.
        const details = safeProviderErrorDetails(error);
        const didNotReceiveHttpResponse = details.providerStatusCode === null;
        console.error(didNotReceiveHttpResponse
            ? "Incident email request did not receive an HTTP response"
            : "Incident email provider rejected the send request", {
            ...details,
            retryable: isRetryableProviderFailure(error),
        });
        throw new EmailDeliveryError(isRetryableProviderFailure(error));
    }

    if (!data || typeof data.id !== "string" || !data.id) {
        console.error("Incident email provider returned no delivery confirmation");
        throw new EmailDeliveryError(true);
    }

    return data;
}
