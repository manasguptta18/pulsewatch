import api from "./api";

export type MonitorCheck = {
    status: string;
    statusCode: number | null;
    latencyMs: number | null;
    errorMessage: string | null;
    checkedAt: string;
};

export type MonitorIncident = {
    id: number;
    type: string;
    status: string;
    reason: string | null;
    startedAt: string;
    resolvedAt: string | null;
};

export type Monitor = {
    id: number;
    name: string;
    url: string;
    method: string;
    intervalSeconds: number;
    timeoutSeconds: number;
    expectedStatus: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;

    checks: MonitorCheck[];

    incidents: MonitorIncident[];
};

export async function getMonitors() {
    const response = await api.get<Monitor[]>(
        "/monitors"
    );

    return response.data;
}