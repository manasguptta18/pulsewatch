import api from "./api";

export type IncidentInvestigation = {
    incidentId: number;
    monitorName: string;
    type: string;
    status: string;
    hypothesis: string;
    summary: string;
    evidence: string[];
    recommendedChecks: string[];
};

export type IncidentAISummary = {
    investigation: IncidentInvestigation;
    aiSummary: string;
};

export type IncidentListItem = {
    id: number;
    monitorId: number;
    monitor: { id: number; name: string };
    type: "AVAILABILITY" | "PERFORMANCE";
    status: "ONGOING" | "RESOLVED";
    reason: string | null;
    startedAt: string;
    resolvedAt: string | null;
};

export type IncidentListFilters = {
    status?: IncidentListItem["status"];
    type?: IncidentListItem["type"];
    after?: number;
    limit?: number;
};

export async function getIncidents(filters: IncidentListFilters = {}) {
    const response = await api.get<IncidentListItem[]>("/incidents", {
        params: filters,
    });
    const cursorHeader = response.headers["x-next-cursor"];
    const nextCursor = typeof cursorHeader === "string" && /^[1-9]\d*$/.test(cursorHeader)
        ? Number(cursorHeader)
        : null;
    return {
        incidents: response.data,
        nextCursor,
        hasMore: response.headers["x-has-more"] === "true",
    };
}

export async function getIncidentAISummary(incidentId: number): Promise<IncidentAISummary> {
    const response = await api.get<IncidentAISummary>(`/incidents/${incidentId}/ai-summary`, {
        timeout: 120_000,
    });
    return response.data;
}
