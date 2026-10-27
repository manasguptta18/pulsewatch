import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
    ScatterChart,
    Scatter,
    ZAxis,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import AppShell from "../components/AppShell";

import {
    connectSocket,
} from "../lib/socket";

import {
    getMonitors,
    type Monitor,
    type MonitorIncident,
    withLatestCheck,
} from "../services/monitor.service";
import { getApiErrorMessage } from "../services/api";

import "./Dashboard.css";

type LiveIncidentMessage = {
    type: "created" | "resolved";
    monitorId: number;
    incidentId: number;
    incidentType: string;
    reason?: string;
};

type IncidentSocketPayload = {
    incidentId: number;
    monitorId: number;
    type: string;
    status: string;
    reason: string | null;
    startedAt?: string;
    resolvedAt?: string | null;
};

function Dashboard() {
    const navigate = useNavigate();

    const [monitors, setMonitors] = useState<Monitor[]>(
        []
    );

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [liveIncident, setLiveIncident] =
        useState<LiveIncidentMessage | null>(null);

    const [socketConnected, setSocketConnected] =
        useState(false);
    const [currentTime, setCurrentTime] = useState(0);

    const loadMonitors = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setMonitors(await getMonitors());
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, "Unable to load your monitors."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        getMonitors().then((data) => {
            if (active) setMonitors(data);
        }).catch((requestError: unknown) => {
            if (active) setError(getApiErrorMessage(requestError, "Unable to load your monitors."));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const socket = connectSocket();
        function handleConnect() {
            setSocketConnected(true);
            void loadMonitors();
        }

        function handleDisconnect() {
            setSocketConnected(false);
        }

        function handleMonitorUpdate(payload: {
            monitorId: number;
            check: Monitor["checks"][number];
        }) {
            setMonitors((currentMonitors) =>
                currentMonitors.map((monitor) => {
                    if (
                        monitor.id !==
                        payload.monitorId
                    ) {
                        return monitor;
                    }

                    return withLatestCheck(monitor, payload.check);
                })
            );
        }

        function handleIncidentCreated(
            payload: IncidentSocketPayload
        ) {
            if (!payload.startedAt || !Number.isFinite(Date.parse(payload.startedAt))) {
                void loadMonitors();
                return;
            }
            const newIncident: MonitorIncident = {
                id: payload.incidentId,
                type: payload.type,
                status: payload.status,
                reason: payload.reason ?? null,
                startedAt: payload.startedAt,
                resolvedAt: null,
            };

            setMonitors((currentMonitors) =>
                currentMonitors.map((monitor) => {
                    if (
                        monitor.id !==
                        payload.monitorId
                    ) {
                        return monitor;
                    }

                    return {
                        ...monitor,
                        incidents: [
                            newIncident,
                            ...monitor.incidents.filter((incident) => incident.id !== newIncident.id),
                        ].slice(0, 20),
                    };
                })
            );

            setLiveIncident({
                type: "created",
                incidentId: payload.incidentId,
                monitorId: payload.monitorId,
                incidentType: payload.type,
                reason:
                    payload.reason ??
                    undefined,
            });
        }

        function handleIncidentResolved(
            payload: IncidentSocketPayload
        ) {
            setMonitors((currentMonitors) =>
                currentMonitors.map((monitor) => {
                    if (
                        monitor.id !==
                        payload.monitorId
                    ) {
                        return monitor;
                    }

                    return {
                        ...monitor,

                        incidents:
                            monitor.incidents.filter(
                                (incident) =>
                                    incident.id !==
                                    payload.incidentId
                            ),
                    };
                })
            );

            setLiveIncident({
                type: "resolved",
                incidentId: payload.incidentId,
                monitorId: payload.monitorId,
                incidentType: payload.type,
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
    }, [loadMonitors]);

    function getStatus(monitor: Monitor) {
        const latestCheck = monitor.checks[0];

        const activeIncident =
            monitor.incidents[0];

        if (
            activeIncident?.type ===
            "PERFORMANCE"
        ) {
            return "DEGRADED";
        }

        if (!latestCheck) {
            return "UNKNOWN";
        }

        if (latestCheck.status === "DOWN") {
            return "DOWN";
        }

        if (latestCheck.status === "UP") {
            return "UP";
        }

        return "UNKNOWN";
    }

    function formatLatency(monitor: Monitor) {
        const latency =
            monitor.checks[0]?.latencyMs;

        if (
            latency === null ||
            latency === undefined
        ) {
            return "—";
        }

        return `${latency} ms`;
    }

    function formatLastChecked(
        monitor: Monitor
    ) {
        const checkedAt =
            monitor.checks[0]?.checkedAt;

        if (!checkedAt) {
            return "Never";
        }

        const difference =
            currentTime -
            new Date(checkedAt).getTime();

        const seconds = Math.floor(
            difference / 1000
        );

        if (seconds < 60) {
            return `${Math.max(
                seconds,
                0
            )}s ago`;
        }

        const minutes = Math.floor(
            seconds / 60
        );

        if (minutes < 60) {
            return `${minutes}m ago`;
        }

        const hours = Math.floor(
            minutes / 60
        );

        return `${hours}h ago`;
    }

    const onlineCount = monitors.filter(
        (monitor) =>
            getStatus(monitor) === "UP"
    ).length;

    const degradedCount = monitors.filter(
        (monitor) =>
            getStatus(monitor) === "DEGRADED"
    ).length;

    const downCount = monitors.filter(
        (monitor) =>
            getStatus(monitor) === "DOWN"
    ).length;

    const activeIntervals = Array.from(new Set(
        monitors.filter((monitor) => monitor.isActive).map((monitor) => monitor.intervalSeconds)
    )).sort((left, right) => left - right);
    const overviewUnavailable = loading || Boolean(error);

    const activeIncidents =
        monitors.flatMap(
            (monitor) =>
                monitor.incidents ?? []
        );

    const chartData = monitors.map((monitor) => ({
        monitor,
        points: monitor.checks.slice(0, 20)
            .filter((check) => check.latencyMs !== null && Number.isFinite(Date.parse(check.checkedAt)))
            .map((check) => ({
                timestamp: Date.parse(check.checkedAt),
                latency: check.latencyMs as number,
                status: check.status,
            })),
    }));
    const visibleChartData = chartData.filter(({ points }) => points.length > 0);
    const hasLatencyPoints = visibleChartData.length > 0;

    const latestLatencies = monitors
        .map((monitor) => monitor.checks[0]?.latencyMs)
        .filter((latency): latency is number => latency !== null && latency !== undefined);
    const averageLatency = latestLatencies.length > 0
        ? Math.round(latestLatencies.reduce((total, latency) => total + latency, 0) / latestLatencies.length)
        : null;

    const chartColors = [
        "#7467ff",
        "#31c48d",
        "#f59e0b",
        "#ef4444",
        "#22d3ee",
        "#ec4899",
        "#8b5cf6",
        "#84cc16",
    ];

    return (
        <AppShell activeSection="dashboard" pageTitle="Overview" realtimeConnected={socketConnected} incidentCount={activeIncidents.length}>
                <div className="dashboard-main">
                    <div className="page-header">
                        <div>
                            <p className="eyebrow">
                                SYSTEM OVERVIEW
                            </p>

                            <h1>
                                API reliability
                                at a glance
                            </h1>

                            <p className="page-subtitle">
                                Monitor health,
                                response
                                performance, and
                                active incidents
                                in real time.
                            </p>
                        </div>

                        <button className="primary-button" onClick={() => navigate("/monitors", { state: { openCreate: true } })}>
                            + Add Monitor
                        </button>
                    </div>

                    {error && (
                        <div className="dashboard-error" role="alert">
                            <span>{error}</span>
                            <button type="button" onClick={() => void loadMonitors()}>Retry</button>
                        </div>
                    )}

                    {liveIncident && (
                        <div
                            className={`live-incident-banner ${
                                liveIncident.type ===
                                "created"
                                    ? "incident-created"
                                    : "incident-resolved"
                            }`}
                            role="status"
                            aria-live="polite"
                        >
                            <div className="live-incident-icon">
                                {liveIncident.type ===
                                "created"
                                    ? "!"
                                    : "✓"}
                            </div>

                            <div className="live-incident-content">
                                <strong>
                                    {liveIncident.type ===
                                    "created"
                                        ? "Incident detected"
                                        : "Incident resolved"}
                                </strong>

                                <span>
                                    {
                                        liveIncident.incidentType
                                    }

                                    {" · "}

                                    Monitor #
                                    {
                                        liveIncident.monitorId
                                    }
                                </span>

                                {liveIncident.reason && (
                                    <small>
                                        {
                                            liveIncident.reason
                                        }
                                    </small>
                                )}
                            </div>

                            <button
                                className="live-incident-close"
                                onClick={() =>
                                    setLiveIncident(
                                        null
                                    )
                                }
                                aria-label="Dismiss incident notification"
                            >
                                ×
                            </button>
                        </div>
                    )}

                    <section className="overview-row">
                        <div>
                            <span className="metric-label">
                                Monitors
                            </span>

                            <strong>
                                {overviewUnavailable ? "—" : monitors.length}
                            </strong>
                        </div>

                        <div>
                            <span className="metric-label">
                                Healthy
                            </span>

                            <strong className="online-text">
                                {overviewUnavailable ? "—" : onlineCount}
                            </strong>
                        </div>

                        <div>
                            <span className="metric-label">
                                Degraded
                            </span>

                            <strong className="degraded-text">
                                {overviewUnavailable ? "—" : degradedCount}
                            </strong>
                        </div>

                        <div>
                            <span className="metric-label">
                                Down
                            </span>

                            <strong className="down-text">
                                {overviewUnavailable ? "—" : downCount}
                            </strong>
                        </div>

                        <div>
                            <span className="metric-label">
                                Incidents
                            </span>

                            <strong className="incident-text">
                                {overviewUnavailable ? "—" : activeIncidents.length}
                            </strong>
                        </div>
                    </section>

                    <section className="monitors-section">
                        <div className="section-heading">
                            <div>
                                <div className="section-title-row">
                                    <h2>
                                        Monitors
                                    </h2>

                                    <span className="section-count">
                                        {overviewUnavailable ? "—" : monitors.length}
                                    </span>
                                </div>

                                <p>
                                    Current
                                    health of
                                    monitored
                                    APIs.
                                </p>
                            </div>

                            <button
                                className="text-button"
                                onClick={() =>
                                    navigate(
                                        "/monitors"
                                    )
                                }
                            >
                                View all →
                            </button>
                        </div>

                        <div className="monitor-table">
                            <div className="table-header">
                                <span>
                                    Status
                                </span>

                                <span>
                                    Monitor
                                </span>

                                <span>
                                    Endpoint
                                </span>

                                <span>
                                    Latency
                                </span>

                                <span>
                                    HTTP
                                </span>

                                <span>
                                    Checked
                                </span>

                                <span />
                            </div>

                            {loading ? (
                                <div className="table-message">
                                    Loading
                                    monitors...
                                </div>
                            ) : error ? (
                                <div className="table-message">Monitor data is unavailable. Use Retry above to try again.</div>
                            ) : monitors.length ===
                              0 ? (
                                <div className="table-message">
                                    No monitors
                                    configured
                                    yet.
                                </div>
                            ) : (
                                monitors
                                    .slice(
                                        0,
                                        5
                                    )
                                    .map(
                                        (
                                            monitor
                                        ) => {
                                            const status =
                                                getStatus(
                                                    monitor
                                                );

                                            return (
                                                <div
                                                    className="monitor-row"
                                                    key={
                                                        monitor.id
                                                    }
                                                >
                                                    <span>
                                                        <span
                                                            className={`status-pill ${status.toLowerCase()}`}
                                                        >
                                                            <span className="status-dot" />

                                                            {
                                                                status
                                                            }
                                                        </span>
                                                    </span>

                                                    <div className="monitor-name-cell">
                                                        <button
                                                            className="monitor-name-link"
                                                            type="button"
                                                            onClick={() =>
                                                                navigate(
                                                                    `/monitors/${monitor.id}`
                                                                )
                                                            }
                                                        >
                                                            {monitor.name}
                                                        </button>

                                                        {monitor.incidents[0] && (
                                                            <span>
                                                                {
                                                                    monitor
                                                                        .incidents[0]
                                                                        .type
                                                                }{" "}
                                                                incident
                                                            </span>
                                                        )}
                                                    </div>

                                                    <span className="url-cell">
                                                        {
                                                            monitor.url
                                                        }
                                                    </span>

                                                    <span className="latency-cell">
                                                        {formatLatency(
                                                            monitor
                                                        )}
                                                    </span>

                                                    <span>
                                                        {monitor
                                                            .checks[0]
                                                            ?.statusCode ??
                                                            "—"}
                                                    </span>

                                                    <span className="checked-cell">
                                                        {formatLastChecked(
                                                            monitor
                                                        )}
                                                    </span>

                                                    <button
                                                        className="row-action"
                                                        onClick={() =>
                                                            navigate(
                                                                `/monitors/${monitor.id}`
                                                            )
                                                        }
                                                        aria-label={`Open ${monitor.name}`}
                                                    >
                                                        →
                                                    </button>
                                                </div>
                                            );
                                        }
                                    )
                            )}
                        </div>
                    </section>

                    <section className="lower-grid">
                        <div className="analysis-panel">
                            <div className="section-heading">
                                <div>
                                    <div className="section-title-row">
                                        <h2>
                                            Response time
                                        </h2>

                                        <span className="chart-period">
                                            Up to 20 per monitor
                                        </span>
                                    </div>

                                    <p>
                                        Each dot is one timestamped latency measurement. Checks without latency remain in monitor history.
                                    </p>
                                </div>

                                <span className="panel-note">
                                    Live
                                </span>
                            </div>

                            <div className="analysis-content">
                                <div className="analysis-chart">
                                    {error ? (
                                        <div className="chart-empty">Latency history is unavailable. Retry loading monitors to refresh it.</div>
                                    ) : !hasLatencyPoints ? (
                                        <div className="chart-empty">
                                            No response
                                            data
                                            available
                                            yet.
                                        </div>
                                    ) : (
                                        <ResponsiveContainer
                                            width="100%"
                                            height={
                                                270
                                            }
                                        >
                                            <ScatterChart
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
                                                    dataKey="timestamp"
                                                    type="number"
                                                    domain={["dataMin", "dataMax"]}
                                                    tickFormatter={(value) => new Date(Number(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
                                                        28
                                                    }
                                                />

                                                <YAxis
                                                    dataKey="latency"
                                                    type="number"
                                                    domain={["auto", "auto"]}
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

                                                <ZAxis range={[48, 48]} />

                                                <Tooltip
                                                    contentStyle={{
                                                        background:
                                                            "var(--chart-tooltip-bg)",
                                                        border: "1px solid var(--border)",
                                                        borderRadius:
                                                            "8px",
                                                        color: "var(--chart-tooltip-text)",
                                                        boxShadow:
                                                            "0 12px 30px rgba(0,0,0,0.25)",
                                                    }}
                                                    labelStyle={{
                                                        color: "var(--muted)",
                                                        marginBottom:
                                                            "4px",
                                                    }}
                                                    labelFormatter={(value) => new Date(Number(value)).toLocaleString()}
                                                    formatter={(value) => [`${value} ms`, "Latency"]}
                                                />

                                                {visibleChartData.map(({ monitor, points }, index) => (
                                                    <Scatter key={monitor.id} name={monitor.name} data={points} dataKey="latency" fill={chartColors[index % chartColors.length]} />
                                                ))}
                                            </ScatterChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>

                                <div className="chart-legend">
                                    {visibleChartData.map(
                                        ({ monitor }, index) => (
                                            <div
                                                className="legend-item"
                                                key={
                                                    monitor.id
                                                }
                                            >
                                                <span
                                                    className="legend-line"
                                                    style={{
                                                        backgroundColor:
                                                            chartColors[
                                                                index %
                                                                    chartColors.length
                                                            ],
                                                    }}
                                                />

                                                <span>
                                                    {
                                                        monitor.name
                                                    }
                                                </span>

                                                <strong>
                                                    {formatLatency(
                                                        monitor
                                                    )}
                                                </strong>
                                            </div>
                                        )
                                    )}
                                </div>

                                <div className="analysis-labels">
                                    <span>
                                        Mean of latest available latencies ({latestLatencies.length} monitors)
                                    </span>

                                    <strong>
                                        {averageLatency !==
                                        null
                                            ? `${averageLatency} ms`
                                            : "—"}
                                    </strong>
                                </div>
                            </div>
                        </div>

                        <div className="side-stack">
                            <div className="incidents-panel">
                                <div className="section-heading">
                                    <div>
                                        <h2>
                                            Active incidents
                                        </h2>

                                        <p>
                                            Issues
                                            currently
                                            affecting
                                            monitored
                                            services.
                                        </p>
                                    </div>

                                    {!overviewUnavailable && activeIncidents.length >
                                        0 && (
                                        <span className="incident-counter">
                                            {
                                                activeIncidents.length
                                            }
                                        </span>
                                    )}
                                </div>

                                <div className="incident-list">
                                    {loading || error || monitors.length === 0 || activeIncidents.length === 0 ? (
                                        <div className="no-incidents">
                                            {!loading && !error && monitors.length > 0 && <span className="healthy-check">✓</span>}

                                            <div>
                                                <strong>
                                                    {loading
                                                        ? "Loading incident data…"
                                                        : error
                                                          ? "Incident data is unavailable"
                                                          : monitors.length === 0
                                                            ? "Add a monitor to see incidents"
                                                            : "No active incidents"}
                                                </strong>

                                                <span>
                                                    {loading
                                                        ? "Waiting for monitor data."
                                                        : error
                                                          ? "Retry monitor loading to refresh incident data."
                                                          : monitors.length === 0
                                                            ? "Incident status appears here after you create a monitor."
                                                            : "All monitored services are operating normally."}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        activeIncidents.map(
                                            (
                                                incident
                                            ) => {
                                                const monitor =
                                                    monitors.find(
                                                        (
                                                            item
                                                        ) =>
                                                            item.incidents.some(
                                                                (
                                                                    current
                                                                ) =>
                                                                    current.id ===
                                                                    incident.id
                                                            )
                                                    );

                                                return (
                                                    <button
                                                        className="incident-item"
                                                        key={
                                                            incident.id
                                                        }
                                                        onClick={() => monitor && navigate(`/monitors/${monitor.id}`)}
                                                    >
                                                        <span
                                                            className={`incident-severity ${
                                                                incident.type ===
                                                                "PERFORMANCE"
                                                                    ? "degraded"
                                                                    : "down"
                                                            }`}
                                                        />

                                                        <div className="incident-item-main">
                                                            <strong>
                                                                {
                                                                    monitor?.name ??
                                                                    "Monitor"
                                                                }
                                                            </strong>

                                                            <span>
                                                                {
                                                                    incident.type
                                                                }
                                                            </span>

                                                            <small>
                                                                {
                                                                    incident.reason
                                                                }
                                                            </small>
                                                        </div>

                                                        <span className="incident-arrow">
                                                            →
                                                        </span>
                                                    </button>
                                                );
                                            }
                                        )
                                    )}
                                </div>
                            </div>

                            <div className="status-panel">
                                <div className="section-heading">
                                    <div>
                                        <h2>
                                            System status
                                        </h2>

                                        <p>
                                            PulseWatch
                                            monitoring
                                            service.
                                        </p>
                                    </div>
                                </div>

                                <div className="system-status">
                                    <span
                                        className={`status-dot ${
                                            socketConnected
                                                ? "up"
                                                : "down"
                                        }`}
                                    />

                                    <div>
                                        <strong>
                                            Realtime
                                            monitoring
                                        </strong>

                                        <span>
                                            {socketConnected
                                                ? "Connected and receiving live events"
                                                : "Connection to realtime server is unavailable"}
                                        </span>
                                    </div>
                                </div>

                                <div className="status-divider" />

                                <div className="system-stat">
                                    <span>
                                        Active monitor intervals
                                    </span>

                                    <strong>
                                        {overviewUnavailable || activeIntervals.length === 0 ? "—" : activeIntervals.map((seconds) => `${seconds}s`).join(" · ")}
                                    </strong>
                                </div>

                                <div className="system-stat">
                                    <span>
                                        Active
                                        monitors
                                    </span>

                                    <strong>
                                        {
                                            overviewUnavailable ? "—" : monitors.filter(
                                                (
                                                    monitor
                                                ) =>
                                                    monitor.isActive
                                            ).length
                                        }
                                    </strong>
                                </div>

                                <div className="system-stat">
                                    <span>
                                        Active
                                        incidents
                                    </span>

                                    <strong>
                                        {overviewUnavailable ? "—" : activeIncidents.length}
                                    </strong>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
        </AppShell>
    );
}

export default Dashboard;
