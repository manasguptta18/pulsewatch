import api from "./api";

export type MonitorCheck = {
    id?: number;
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
    baselineLatencyMs?: number | null;
};

export type Monitor = {
    id: number;
    userId: number;
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

export type CreateMonitorInput = {
    name: string;
    url: string;
};

export type UpdateMonitorInput = Partial<{
    name: string;
    url: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    intervalSeconds: number;
    timeoutSeconds: number;
    expectedStatus: number;
    isActive: boolean;
}>;

export type MonitorRecord = Omit<Monitor, "checks" | "incidents">;

export async function getMonitors() {
    const response = await api.get<Monitor[]>(
        "/monitors"
    );

    return response.data;
}

export async function getMonitorById(
    monitorId: number
) {
    const response = await api.get<Monitor>(
        `/monitors/${monitorId}`
    );

    return response.data;
}

export async function runMonitorCheck(
    monitorId: number,
    timeoutSeconds = 5,
) {
    const response = await api.post<MonitorCheck>(
        `/monitors/${monitorId}/check`,
        undefined,
        { timeout: Math.max(20_000, (timeoutSeconds + 15) * 1_000) },
    );

    return response.data;
}

export async function createMonitor(data: CreateMonitorInput): Promise<MonitorRecord> {
    const response = await api.post<MonitorRecord>("/monitors", data);
    return response.data;
}

export async function updateMonitor(
    monitorId: number,
    data: UpdateMonitorInput,
): Promise<MonitorRecord> {
    const response = await api.patch<MonitorRecord>(`/monitors/${monitorId}`, data);
    return response.data;
}

export async function deleteMonitor(monitorId: number): Promise<{ message: string }> {
    const response = await api.delete<{ message: string }>(`/monitors/${monitorId}`);
    return response.data;
}

/** Merge socket/API check results without duplicating the same persisted check. */
export function withLatestCheck(monitor: Monitor, check: MonitorCheck): Monitor {
    const checks = [check, ...monitor.checks.filter((item) => item.checkedAt !== check.checkedAt)];
    return { ...monitor, checks: checks.slice(0, 50) };
}
