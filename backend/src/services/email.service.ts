import "dotenv/config";
import {Resend} from "resend";

const apiKey = process.env.RESEND_API_KEY;

if(!apiKey){
    throw new Error("RESEND_API_KEY is not defined");
}

const resend = new Resend(apiKey);

export async function sendIncidentEmail(destination: string,
    monitorName: string,
    incidentType: string,
    reason: string
){
    const {data,error} = await resend.emails.send({
        from: "PulseWatch <onboarding@resend.dev>",
        to: [destination],
        subject:  `🚨 PulseWatch Alert: ${monitorName}`,
        html: `
            <h2>PulseWatch Incident Alert</h2>

            <p><strong>Monitor:</strong> ${monitorName}</p>

            <p><strong>Incident Type:</strong> ${incidentType}</p>

            <p><strong>Reason:</strong> ${reason}</p>

            <p>
                PulseWatch detected an issue with your monitored API.
            </p>
        `,
    });

    if(error){
        throw new Error(error.message);
    }

    return data;
}