import ollama from "ollama";

type investigationData = {
    incidentId: number;
    monitorName: string;
    type: string;
    status: string;
    hypothesis: string;
    summary: string;
    evidence: string[];
    recommendedChecks: string[];
};

export async function generateIncidentSummary(investigation: investigationData){
    const prompt = `
    You are an incident analysis assistant for PulseWatch.

    Use ONLY the information provided below.

    Do not invent logs, metrics, causes, or facts.

    The hypothesis is only a possibility, not a confirmed root cause.

    Explain the incident in simple, practical language.

    Include:
    1. What happened
    2. What evidence supports it
    3. What the engineer should investigate next

    Keep the response concise.

    Investigation Data:
    ${JSON.stringify(investigation,null,2)}
        `;

        const response = await ollama.chat({
            model: 'qwen3:8b',
            messages: [
                {
                    role: "system",
                    content: "You are a careful production incident analysis assistant.",
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],
            think: false,
            stream: false,
            options:{
                temperature: 0.2,
            },
        });

        return response.message.content;
}