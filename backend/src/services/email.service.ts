import "dotenv/config";
import {Resend} from "resend";

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
    const candidate = error as { statusCode?: unknown; status?: unknown };
    const status = typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : candidate.status;
    if (typeof status !== "number") return true;
    return status === 408 || status === 429 || status >= 500;
}

export async function sendIncidentEmail(destination: string,
    monitorName: string,
    incidentType: string,
    reason: string
){
    if (!process.env.RESEND_API_KEY) {
        throw new EmailDeliveryError(false);
    }
    resend ??= new Resend(process.env.RESEND_API_KEY);

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
        });
    } catch (error) {
        throw new EmailDeliveryError(isRetryableProviderFailure(error));
    }

    const { data, error } = result;

    if (error) {
        // Provider errors can include request metadata; keep credentials and
        // internal delivery details out of application logs.
        console.error("Incident email provider rejected the send request");
        throw new EmailDeliveryError(isRetryableProviderFailure(error));
    }

    return data;
}
