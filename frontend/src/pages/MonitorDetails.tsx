import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
    useNavigate,
    useParams,
} from "react-router-dom";
import AppShell from "../components/AppShell";

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

import {
    connectSocket,
} from "../lib/socket";

import {
    getMonitorById,
    updateMonitor,
    deleteMonitor,
    runMonitorCheck,
    type Monitor,
    type MonitorIncident,
    withLatestCheck,
} from "../services/monitor.service";
import { getApiErrorMessage } from "../services/api";
import { getIncidentAISummary, type IncidentAISummary } from "../services/incident.service";

import "./MonitorDetails.css";

function MonitorDetails() {
    const navigate = useNavigate();

    const { id } = useParams();

    const monitorId = Number(id);

    const [monitor, setMonitor] =
        useState<Monitor | null>(null);

    const [loading, setLoading] =
        useState(Number.isSafeInteger(monitorId) && monitorId > 0);

    const [error, setError] =
        useState(Number.isSafeInteger(monitorId) && monitorId > 0 ? "" : "Invalid monitor ID");

    const [checking, setChecking] =
        useState(false);

    const [socketConnected, setSocketConnected] =
        useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [editName, setEditName] = useState("");
    const [editUrl, setEditUrl] = useState("");
    const [editInterval, setEditInterval] = useState(60);
    const [editTimeout, setEditTimeout] = useState(10);
    const [editExpectedStatus, setEditExpectedStatus] = useState(200);
    const [editIsActive, setEditIsActive] = useState(true);
    const [investigationResults, setInvestigationResults] = useState<Record<number, IncidentAISummary>>({});
    const [investigationErrors, setInvestigationErrors] = useState<Record<number, string>>({});
    const [loadingIncidentId, setLoadingIncidentId] = useState<number | null>(null);
    const [expandedIncidentId, setExpandedIncidentId] = useState<number | null>(null);
    const investigationInFlight = useRef(false);
    const [editMethod, setEditMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">("GET");

    const loadMonitor = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            if (!Number.isSafeInteger(monitorId) || monitorId <= 0) {
                throw new Error("Invalid monitor ID");
            }
            setMonitor(await getMonitorById(monitorId));
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, "Unable to load this monitor."));
        } finally {
            setLoading(false);
        }
    }, [monitorId]);

    useEffect(() => {
        let active = true;
        if (!Number.isSafeInteger(monitorId) || monitorId <= 0) {
            return;
        }
        getMonitorById(monitorId).then((data) => {
            if (active) setMonitor(data);
        }).catch((requestError: unknown) => {
            if (active) setError(getApiErrorMessage(requestError, "Unable to load this monitor."));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [monitorId]);

    useEffect(() => {
        if (!Number.isInteger(monitorId)) {
            return;
        }

        const socket = connectSocket();

        function handleConnect() {
            setSocketConnected(true);
            void loadMonitor();
        }

        function handleDisconnect() {
            setSocketConnected(false);
        }

        function handleMonitorUpdate(
            payload: {
                monitorId: number;
                check: Monitor["checks"][number];
            }
        ) {
            if (
                payload.monitorId !==
                monitorId
            ) {
                return;
            }

            setMonitor((current) => {
                if (!current) {
                    return current;
                }

                return withLatestCheck(current, payload.check);
            });
        }

        function handleIncidentCreated(
            payload: {
                incidentId: number;
                monitorId: number;
                type: string;
                status: string;
                reason: string | null;
                startedAt: string;
            }
        ) {
            if (
                payload.monitorId !==
                monitorId
            ) {
                return;
            }

            const incident: MonitorIncident = {
                id: payload.incidentId,
                type: payload.type,
                status: payload.status,
                reason: payload.reason,
                startedAt:
                    payload.startedAt,
                resolvedAt: null,
                baselineLatencyMs: null,
            };

            setMonitor((current) => {
                if (!current) {
                    return current;
                }

                const existing =
                    current.incidents.some(
                        (item) =>
                            item.id ===
                            incident.id
                    );

                if (existing) {
                    return current;
                }

                return {
                    ...current,
                    incidents: [
                        incident,
                        ...current.incidents,
                    ].slice(0, 20),
                };
            });
        }

        function handleIncidentResolved(
            payload: {
                incidentId: number;
                monitorId: number;
                resolvedAt:
                    | string
                    | null;
            }
        ) {
            if (
                payload.monitorId !==
                monitorId
            ) {
                return;
            }

            setMonitor((current) => {
                if (!current) {
                    return current;
                }

                return {
                    ...current,

                    incidents:
                        current.incidents.map(
                            (incident) => {
                                if (
                                    incident.id !==
                                    payload.incidentId
                                ) {
                                    return incident;
                                }

                                return {
                                    ...incident,
                                    status: "RESOLVED",
                                    resolvedAt:
                                        payload.resolvedAt,
                                };
                            }
                        ),
                };
            });
        }

        socket.on(
            "connect",
            handleConnect
        );

        socket.on(
            "disconnect",
            handleDisconnect
        );

        socket.on(
            "monitor:updated",
            handleMonitorUpdate
        );

        socket.on(
            "incident:created",
            handleIncidentCreated
        );

        socket.on(
            "incident:resolved",
            handleIncidentResolved
        );

        if (socket.connected) {
            handleConnect();
        }

        return () => {
            socket.off(
                "connect",
                handleConnect
            );

            socket.off(
                "disconnect",
                handleDisconnect
            );

            socket.off(
                "monitor:updated",
                handleMonitorUpdate
            );

            socket.off(
                "incident:created",
                handleIncidentCreated
            );

            socket.off(
                "incident:resolved",
                handleIncidentResolved
            );

        };
    }, [loadMonitor, monitorId]);

    async function handleRunCheck() {
        if (!monitor) {
            return;
        }

        setChecking(true);
        setError("");

        try {
            const check = await runMonitorCheck(monitor.id, monitor.timeoutSeconds);
            setMonitor((current) => current ? withLatestCheck(current, check) : current);
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, "Unable to run monitor check."));
        } finally {
            setChecking(false);
        }
    }

    function beginEdit() {
        if (!monitor) return;
        setEditName(monitor.name);
        setEditUrl(monitor.url);
        setEditInterval(monitor.intervalSeconds);
        setEditTimeout(monitor.timeoutSeconds);
        setEditExpectedStatus(monitor.expectedStatus);
        setEditIsActive(monitor.isActive);
        setEditMethod(monitor.method as typeof editMethod);
        setError("");
        setShowEditForm(true);
    }

    async function handleUpdateMonitor(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!monitor) return;
        setSaving(true);
        setError("");
        try {
            const updated = await updateMonitor(monitor.id, {
                name: editName.trim(),
                url: editUrl.trim(),
                method: editMethod,
                intervalSeconds: editInterval,
                timeoutSeconds: editTimeout,
                expectedStatus: editExpectedStatus,
                isActive: editIsActive,
            });
            setMonitor((current) => current ? { ...current, ...updated } : current);
            setShowEditForm(false);
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, "Unable to update this monitor."));
        } finally {
            setSaving(false);
        }
    }

    async function handleDeleteMonitor() {
        if (!monitor || !window.confirm(`Delete monitor “${monitor.name}”? This also removes its monitor history.`)) return;
        setDeleting(true);
        setError("");
        try {
            await deleteMonitor(monitor.id);
            navigate("/monitors", { replace: true });
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, "Unable to delete this monitor."));
            setDeleting(false);
        }
    }

    async function handleInvestigateIncident(incidentId: number) {
        if (investigationInFlight.current || loadingIncidentId !== null) return;
        if (investigationResults[incidentId]) {
            setExpandedIncidentId((current) => current === incidentId ? null : incidentId);
            return;
        }

        investigationInFlight.current = true;
        setLoadingIncidentId(incidentId);
        setInvestigationErrors((current) => {
            const next = { ...current };
            delete next[incidentId];
            return next;
        });
        setExpandedIncidentId(incidentId);
        try {
            const result = await getIncidentAISummary(incidentId);
            setInvestigationResults((current) => ({ ...current, [incidentId]: result }));
        } catch (requestError) {
            setInvestigationErrors((current) => ({
                ...current,
                [incidentId]: getApiErrorMessage(requestError, "Unable to investigate this incident."),
            }));
        } finally {
            investigationInFlight.current = false;
            setLoadingIncidentId(null);
        }
    }

    const activeIncident =
        monitor?.incidents.find(
            (incident) =>
                incident.status ===
                "ONGOING"
        ) ?? null;

    function getStatus() {
        if (!monitor) {
            return "UNKNOWN";
        }

        if (
            activeIncident?.type ===
            "PERFORMANCE"
        ) {
            return "DEGRADED";
        }

        const latest =
            monitor.checks[0];

        if (!latest) {
            return "UNKNOWN";
        }

        if (latest.status === "DOWN") {
            return "DOWN";
        }

        if (latest.status === "UP") {
            return "UP";
        }

        return "UNKNOWN";
    }

    function formatLatency(
        latency: number | null
    ) {
        if (
            latency === null ||
            latency === undefined
        ) {
            return "—";
        }

        return `${latency} ms`;
    }

    function formatDate(
        date: string | null
    ) {
        if (!date) {
            return "—";
        }

        return new Date(
            date
        ).toLocaleString([], {
            dateStyle: "medium",
            timeStyle: "short",
        });
    }

    const chartData = useMemo(() => {
        if (!monitor) {
            return [];
        }

        return [...monitor.checks]
            .reverse()
            .map((check) => ({
                time: new Date(
                    check.checkedAt
                ).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),

                latency:
                    check.latencyMs,
            }));
    }, [monitor]);

    const recentChecks =
        monitor?.checks.slice(0, 15) ??
        [];

    const latencies =
        monitor?.checks
            .map(
                (check) =>
                    check.latencyMs
            )
            .filter(
                (
                    value
                ): value is number =>
                    value !== null
            ) ?? [];

    const averageLatency =
        latencies.length > 0
            ? Math.round(
                  latencies.reduce(
                      (sum, value) =>
                          sum + value,
                      0
                  ) /
                      latencies.length
              )
            : null;

    const highestLatency =
        latencies.length > 0
            ? Math.max(...latencies)
            : null;

    const hasLatencyMeasurements = chartData.some((point) => point.latency !== null);

    if (loading) {
        return (
            <AppShell activeSection="monitors" pageTitle="Monitor details">
                <div className="details-main">
                    <div className="details-loading" role="status">Loading monitor...</div>
                </div>
            </AppShell>
        );
    }

    if (!monitor) {
        return (
            <AppShell
                activeSection="monitors"
                pageTitle="Monitor details"
                headerContent={<button className="back-button" onClick={() => navigate("/monitors")}>← Monitors</button>}
            >
                <div className="details-main">
                    <div className="details-error" role="alert">
                    <strong>
                        {error || "Monitor not found"}
                    </strong>

                    {error && <button type="button" onClick={() => void loadMonitor()}>Retry</button>}

                    <button
                        onClick={() =>
                            navigate(
                                "/monitors"
                            )
                        }
                    >
                        Back to monitors
                    </button>
                </div>
                </div>
            </AppShell>
        );
    }

    const status = getStatus();

    return (
        <AppShell
            activeSection="monitors"
            pageTitle={monitor.name}
            realtimeConnected={socketConnected}
            headerContent={<button className="back-button" onClick={() => navigate("/monitors")}>← Monitors</button>}
        >
                <div className="details-main">
                    <div className="monitor-details-header">
                        <div>
                            <div className="breadcrumb">
                                Monitors
                                <span>
                                    /
                                </span>
                                {monitor.name}
                            </div>

                            <div className="details-title-row">
                                <h1>
                                    {
                                        monitor.name
                                    }
                                </h1>

                                <span
                                    className={`status-badge ${status.toLowerCase()}`}
                                >
                                    <span className="status-dot" />

                                    {status}
                                </span>
                            </div>

                            <p className="detail-url">
                                {
                                    monitor.url
                                }
                            </p>
                        </div>

                        <div className="monitor-actions">
                        <button type="button" className="secondary-action" onClick={beginEdit}>Edit</button>
                        <button type="button" className="danger-action" onClick={() => void handleDeleteMonitor()} disabled={deleting}>
                            {deleting ? "Deleting…" : "Delete"}
                        </button>
                        <button
                            className="run-check-button"
                            onClick={
                                handleRunCheck
                            }
                            disabled={
                                checking
                            }
                        >
                            {checking
                                ? "Checking..."
                                : "Run check"}
                        </button>
                        </div>
                    </div>

                    {error && (
                        <div className="details-error-banner" role="alert">
                            {error}
                        </div>
                    )}

                    {showEditForm && (
                        <div className="monitor-edit-backdrop">
                            <form className="monitor-edit-form" onSubmit={handleUpdateMonitor} aria-labelledby="edit-monitor-heading">
                                <div className="monitor-edit-heading">
                                    <div><h2 id="edit-monitor-heading">Edit monitor</h2><p>Changes are saved to your monitoring configuration.</p></div>
                                    <button type="button" className="form-close" onClick={() => setShowEditForm(false)} aria-label="Close edit form">×</button>
                                </div>
                                <label>Monitor name<input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={100} required /></label>
                                <label>Public HTTP or HTTPS URL<input type="url" value={editUrl} onChange={(event) => setEditUrl(event.target.value)} required /></label>
                                <label>HTTP method<select value={editMethod} onChange={(event) => setEditMethod(event.target.value as typeof editMethod)}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}</select></label>
                                <div className="monitor-edit-grid">
                                    <label>Interval (seconds)<input type="number" min={10} max={86400} value={editInterval} onChange={(event) => setEditInterval(Number(event.target.value))} required /></label>
                                    <label>Timeout (seconds)<input type="number" min={1} max={300} value={editTimeout} onChange={(event) => setEditTimeout(Number(event.target.value))} required /></label>
                                    <label>Expected status<input type="number" min={100} max={599} value={editExpectedStatus} onChange={(event) => setEditExpectedStatus(Number(event.target.value))} required /></label>
                                </div>
                                <label className="monitor-active-toggle"><input type="checkbox" checked={editIsActive} onChange={(event) => setEditIsActive(event.target.checked)} /> Monitoring is active</label>
                                {error && <p className="details-form-error" role="alert">{error}</p>}
                                <div className="monitor-edit-actions"><button type="button" className="secondary-action" disabled={saving} onClick={() => setShowEditForm(false)}>Cancel</button><button type="submit" className="run-check-button" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
                            </form>
                        </div>
                    )}

                    {activeIncident && (
                        <section className="active-incident-panel">
                            <div className="incident-symbol">
                                !
                            </div>

                            <div>
                                <div className="active-incident-title">
                                    <strong>
                                        {
                                            activeIncident.type
                                        }{" "}
                                        incident
                                    </strong>

                                    <span>
                                        ONGOING
                                    </span>
                                </div>

                                <p>
                                    {
                                        activeIncident.reason ??
                                        "This monitor currently has an active incident."
                                    }
                                </p>

                                <small>
                                    Started{" "}
                                    {formatDate(
                                        activeIncident.startedAt
                                    )}
                                </small>
                            </div>
                        </section>
                    )}

                    <section className="detail-metrics">
                        <div className="detail-metric">
                            <span>
                                Current latency
                            </span>

                            <strong>
                                {formatLatency(
                                    monitor
                                        .checks[0]
                                        ?.latencyMs ??
                                        null
                                )}
                            </strong>

                            <small>
                                Latest
                                measurement
                            </small>
                        </div>

                        <div className="detail-metric">
                            <span>
                                HTTP status
                            </span>

                            <strong>
                                {monitor
                                    .checks[0]
                                    ?.statusCode ??
                                    "—"}
                            </strong>

                            <small>
                                Expected{" "}
                                {
                                    monitor.expectedStatus
                                }
                            </small>
                        </div>

                        <div className="detail-metric">
                            <span>Mean latency</span>

                            <strong>
                                {formatLatency(
                                    averageLatency
                                )}
                            </strong>

                            <small>
                                Available latency values in the latest {monitor.checks.length} checks
                            </small>
                        </div>

                        <div className="detail-metric">
                            <span>Latency samples</span>
                            <strong>{latencies.length}</strong>
                            <small>From up to 50 recent checks</small>
                        </div>
                    </section>

                    <section className="details-grid">
                        <div className="response-panel">
                            <div className="panel-heading">
                                <div>
                                    <h2>
                                        Response time
                                    </h2>

                                    <p>Up to 50 most recent checks returned by the API. Failed checks without a latency are shown as gaps.</p>
                                </div>

                                <span className="live-label">
                                    Live
                                </span>
                            </div>

                            <div className="detail-chart">
                                {chartData.length === 0 || !hasLatencyMeasurements ? (
                                    <div className="chart-empty">
                                        {chartData.length === 0
                                            ? "No check history available yet."
                                            : "No latency measurements are available in these recent checks."}
                                    </div>
                                ) : (
                                    <ResponsiveContainer
                                        width="100%"
                                        height={
                                            300
                                        }
                                    >
                                        <LineChart
                                            data={
                                                chartData
                                            }
                                            margin={{
                                                top: 10,
                                                right: 10,
                                                left: 0,
                                                bottom: 8,
                                            }}
                                        >
                                            <CartesianGrid
                                                strokeDasharray="3 5"
                                                vertical={
                                                    false
                                                }
                                                stroke="var(--chart-grid)"
                                            />

                                            <XAxis
                                                dataKey="time"
                                                tick={{
                                                    fill: "var(--muted)",
                                                    fontSize: 10,
                                                }}
                                                tickLine={
                                                    false
                                                }
                                                axisLine={
                                                    false
                                                }
                                                minTickGap={
                                                    25
                                                }
                                            />

                                            <YAxis
                                                tick={{
                                                    fill: "var(--muted)",
                                                    fontSize: 10,
                                                }}
                                                tickLine={
                                                    false
                                                }
                                                axisLine={
                                                    false
                                                }
                                                width={
                                                    58
                                                }
                                                tickFormatter={(
                                                    value
                                                ) =>
                                                    `${value}ms`
                                                }
                                            />

                                            <Tooltip
                                                contentStyle={{
                                                    background:
                                                        "var(--chart-tooltip-bg)",
                                                    border: "1px solid var(--border)",
                                                    borderRadius:
                                                        "8px",
                                                    color: "var(--chart-tooltip-text)",
                                                }}
                                                labelStyle={{
                                                    color: "var(--muted)",
                                                }}
                                                formatter={(
                                                    value
                                                    ) => [
                                                        value === null || value === undefined ? "No latency recorded" : `${value} ms`,
                                                        "Latency",
                                                    ]}
                                            />

                                            <Line
                                                type="monotone"
                                                dataKey="latency"
                                                stroke="#7467ff"
                                                strokeWidth={
                                                    2.3
                                                }
                                                dot={
                                                    false
                                                }
                                                activeDot={{
                                                    r: 4,
                                                }}
                                                connectNulls={
                                                    false
                                                }
                                                animationDuration={
                                                    350
                                                }
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}
                            </div>

                            <div className="chart-footer">
                                <div>
                                    <span>
                                        Checks
                                    </span>

                                    <strong>
                                        {
                                            monitor
                                                .checks
                                                .length
                                        }
                                    </strong>
                                </div>

                                <div>
                                    <span>
                                        Average
                                    </span>

                                    <strong>
                                        {formatLatency(
                                            averageLatency
                                        )}
                                    </strong>
                                </div>

                                <div>
                                    <span>
                                        Highest
                                    </span>

                                    <strong>
                                        {formatLatency(
                                            highestLatency
                                        )}
                                    </strong>
                                </div>
                            </div>
                        </div>

                        <div className="configuration-panel">
                            <div className="panel-heading">
                                <div>
                                    <h2>
                                        Configuration
                                    </h2>

                                    <p>
                                        Monitor
                                        settings.
                                    </p>
                                </div>
                            </div>

                            <div className="configuration-list">
                                <div>
                                    <span>
                                        Method
                                    </span>

                                    <strong>
                                        {
                                            monitor.method
                                        }
                                    </strong>
                                </div>

                                <div>
                                    <span>
                                        Interval
                                    </span>

                                    <strong>
                                        {
                                            monitor.intervalSeconds
                                        }
                                        s
                                    </strong>
                                </div>

                                <div>
                                    <span>
                                        Timeout
                                    </span>

                                    <strong>
                                        {
                                            monitor.timeoutSeconds
                                        }s
                                    </strong>
                                </div>

                                <div>
                                    <span>
                                        Expected
                                    </span>

                                    <strong>
                                        {
                                            monitor.expectedStatus
                                        }
                                    </strong>
                                </div>

                                <div>
                                    <span>
                                        Monitoring
                                    </span>

                                    <strong
                                        className={
                                            monitor.isActive
                                                ? "active-config"
                                                : "inactive-config"
                                        }
                                    >
                                        {monitor.isActive
                                            ? "Active"
                                            : "Paused"}
                                    </strong>
                                </div>

                                <div>
                                    <span>
                                        Created
                                    </span>

                                    <strong>
                                        {formatDate(
                                            monitor.createdAt
                                        )}
                                    </strong>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="history-panel">
                        <div className="panel-heading">
                            <div>
                                <h2>
                                    Recent checks
                                </h2>

                                <p>
                                    Latest monitor
                                    responses and
                                    failures.
                                </p>
                            </div>

                            <span className="history-count">
                                {
                                    recentChecks.length
                                }{" "}
                                shown
                            </span>
                        </div>

                        <div className="checks-table">
                            <div className="checks-header">
                                <span>
                                    Status
                                </span>

                                <span>
                                    Time
                                </span>

                                <span>
                                    Latency
                                </span>

                                <span>
                                    HTTP
                                </span>

                                <span>
                                    Error
                                </span>
                            </div>

                            {recentChecks.length ===
                            0 ? (
                                <div className="checks-empty">
                                    No checks recorded
                                    yet.
                                </div>
                            ) : (
                                recentChecks.map(
                                    (
                                        check,
                                        index
                                    ) => (
                                        <div
                                            className="check-row"
                                            key={
                                                check.id ??
                                                `${check.checkedAt}-${index}`
                                            }
                                        >
                                            <span>
                                                <span
                                                    className={`check-status ${check.status.toLowerCase()}`}
                                                >
                                                    <span className="status-dot" />

                                                    {
                                                        check.status
                                                    }
                                                </span>
                                            </span>

                                            <span>
                                                {formatDate(
                                                    check.checkedAt
                                                )}
                                            </span>

                                            <strong>
                                                {formatLatency(
                                                    check.latencyMs
                                                )}
                                            </strong>

                                            <span>
                                                {check
                                                    .statusCode ??
                                                    "—"}
                                            </span>

                                            <span className="check-error">
                                                {
                                                    check.errorMessage ??
                                                    "—"
                                                }
                                            </span>
                                        </div>
                                    )
                                )
                            )}
                        </div>
                    </section>

                    <section className="incident-history-panel">
                        <div className="panel-heading">
                            <div>
                                <h2>
                                    Incident history
                                </h2>

                                <p>
                                    Up to 20 most recent incidents returned for this monitor.
                                </p>
                            </div>

                            <button
                                className="view-incidents-button"
                                onClick={() =>
                                    navigate(
                                        "/incidents"
                                    )
                                }
                            >
                                Incident list info →
                            </button>
                        </div>

                        {monitor.incidents
                            .length ===
                        0 ? (
                            <div className="no-history">
                                <span className="history-check">
                                    ✓
                                </span>

                                <div>
                                    <strong>
                                        No incidents
                                        recorded
                                    </strong>

                                    <span>
                                        This monitor
                                        has not
                                        recorded an
                                        incident.
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="incident-history-list">
                                {monitor.incidents.map(
                                    (
                                        incident
                                    ) => (
                                        <div
                                            className="history-incident"
                                            key={
                                                incident.id
                                            }
                                        >
                                            <span
                                                className={`history-severity ${
                                                    incident.type ===
                                                    "PERFORMANCE"
                                                        ? "performance"
                                                        : "availability"
                                                }`}
                                            />

                                            <div className="history-incident-main">
                                                <div>
                                                    <strong>
                                                        {
                                                            incident.type
                                                        }
                                                    </strong>

                                                    <span
                                                        className={`history-status ${incident.status.toLowerCase()}`}
                                                    >
                                                        {
                                                            incident.status
                                                        }
                                                    </span>
                                                </div>

                                                <p>
                                                    {
                                                        incident.reason
                                                    }
                                                </p>

                                                <small>
                                                    Started{" "}
                                                    {formatDate(
                                                        incident.startedAt
                                                    )}
                                                    {" · "}
                                                    {incident.resolvedAt
                                                        ? `Resolved ${formatDate(
                                                              incident.resolvedAt
                                                          )}`
                                                        : "Still ongoing"}
                                                </small>
                                                <div className="incident-investigation-actions">
                                                    <button
                                                        type="button"
                                                        className="investigate-button"
                                                        disabled={loadingIncidentId !== null}
                                                        onClick={() => void handleInvestigateIncident(incident.id)}
                                                    >
                                                        {loadingIncidentId === incident.id
                                                            ? "Investigating…"
                                                            : investigationResults[incident.id]
                                                              ? expandedIncidentId === incident.id ? "Hide investigation" : "View investigation"
                                                              : "Investigate with AI"}
                                                    </button>
                                                    {investigationErrors[incident.id] && (
                                                        <span className="investigation-error" role="alert">{investigationErrors[incident.id]}</span>
                                                    )}
                                                </div>
                                                {expandedIncidentId === incident.id && investigationResults[incident.id] && (
                                                    <div className="investigation-result" aria-live="polite">
                                                        <h3>AI investigation</h3>
                                                        <p><strong>Possible hypothesis:</strong> {investigationResults[incident.id].investigation.hypothesis}. This is not a confirmed cause.</p>
                                                        {investigationResults[incident.id].aiSummary.trim()
                                                            ? <p className="ai-summary">{investigationResults[incident.id].aiSummary}</p>
                                                            : <p className="investigation-empty">The AI service returned an empty summary.</p>}
                                                        <p><strong>Investigation:</strong> {investigationResults[incident.id].investigation.summary}</p>
                                                        {investigationResults[incident.id].investigation.evidence.length > 0 && (
                                                            <><strong>Evidence</strong><ul>{investigationResults[incident.id].investigation.evidence.map((item, index) => <li key={`${incident.id}-evidence-${index}`}>{item}</li>)}</ul></>
                                                        )}
                                                        {investigationResults[incident.id].investigation.recommendedChecks.length > 0 && (
                                                            <><strong>Recommended checks</strong><ul>{investigationResults[incident.id].investigation.recommendedChecks.map((item, index) => <li key={`${incident.id}-next-${index}`}>{item}</li>)}</ul></>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                )}
                            </div>
                        )}
                    </section>
                </div>
        </AppShell>
    );
}

export default MonitorDetails;
