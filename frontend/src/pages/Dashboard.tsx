import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

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
    disconnectSocket,
} from "../lib/socket";

import {
    getMonitors,
    type Monitor,
    type MonitorIncident,
} from "../services/monitor.service";

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

    useEffect(() => {
        async function loadMonitors() {
            try {
                const data = await getMonitors();

                setMonitors(data);
            } catch {
                setError(
                    "Unable to load your monitors"
                );
            } finally {
                setLoading(false);
            }
        }

        loadMonitors();
    }, []);

    useEffect(() => {
        const socket = connectSocket();

        function handleConnect() {
            console.log(
                "Connected to PulseWatch realtime server:",
                socket.id
            );

            setSocketConnected(true);
        }

        function handleDisconnect() {
            console.log(
                "Disconnected from PulseWatch realtime server"
            );

            setSocketConnected(false);
        }

        function handleMonitorUpdate(payload: {
            monitorId: number;
            check: Monitor["checks"][number];
        }) {
            console.log(
                "Realtime monitor update received:",
                payload
            );

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

                        checks: [
                            payload.check,
                            ...monitor.checks,
                        ].slice(0, 20),
                    };
                })
            );
        }

        function handleIncidentCreated(
            payload: IncidentSocketPayload
        ) {
            console.log(
                "Realtime incident created:",
                payload
            );

            const newIncident: MonitorIncident = {
                id: payload.incidentId,
                type: payload.type,
                status: payload.status,
                reason: payload.reason ?? null,
                startedAt:
                    payload.startedAt ??
                    new Date().toISOString(),
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
                        ],
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
            console.log(
                "Realtime incident resolved:",
                payload
            );

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

            disconnectSocket();
        };
    }, []);

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

    function getStatusClass(monitor: Monitor) {
        return getStatus(monitor).toLowerCase();
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
            Date.now() -
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

    const unknownCount =
        monitors.length -
        onlineCount -
        degradedCount -
        downCount;

    const activeIncidents =
        monitors.flatMap(
            (monitor) =>
                monitor.incidents ?? []
        );

    const chartData = Array.from(
        {
            length: Math.max(
                ...monitors.map(
                    (monitor) =>
                        monitor.checks.length
                ),
                0
            ),
        },
        (_, index) => {
            const point: Record<
                string,
                string | number | null
            > = {
                time: "",
            };

            monitors.forEach((monitor) => {
                const check =
                    monitor.checks[
                        monitor.checks.length -
                            1 -
                            index
                    ];

                point[
                    `monitor_${monitor.id}`
                ] =
                    check?.latencyMs ??
                    null;

                if (
                    !point.time &&
                    check?.checkedAt
                ) {
                    point.time =
                        new Date(
                            check.checkedAt
                        ).toLocaleTimeString(
                            [],
                            {
                                hour: "2-digit",
                                minute: "2-digit",
                            }
                        );
                }
            });

            return point;
        }
    );

    const averageLatency =
        monitors.length > 0
            ? Math.round(
                  monitors.reduce(
                      (
                          total,
                          monitor
                      ) =>
                          total +
                          (monitor
                              .checks[0]
                              ?.latencyMs ??
                              0),
                      0
                  ) /
                      Math.max(
                          monitors.length,
                          1
                      )
              )
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
        <main className="dashboard-page">
            <aside className="sidebar">
                <div className="sidebar-brand">
                    <span className="brand-wave">
                        〰
                    </span>

                    <span>PulseWatch</span>
                </div>

                <nav className="sidebar-nav">
                    <button className="nav-item active">
                        <span>⌂</span>
                        Dashboard
                    </button>

                    <button
                        className="nav-item"
                        onClick={() =>
                            navigate(
                                "/monitors"
                            )
                        }
                    >
                        <span>◉</span>
                        Monitors
                    </button>

                    <button
                        className="nav-item"
                        onClick={() =>
                            navigate(
                                "/incidents"
                            )
                        }
                    >
                        <span>△</span>
                        Incidents

                        {activeIncidents.length >
                            0 && (
                            <span className="nav-count">
                                {
                                    activeIncidents.length
                                }
                            </span>
                        )}
                    </button>
                </nav>

                <div className="sidebar-bottom">
                    <button className="nav-item">
                        <span>⚙</span>
                        Settings
                    </button>

                    <button
                        className="nav-item"
                        onClick={() => {
                            localStorage.removeItem(
                                "token"
                            );

                            navigate("/login");
                        }}
                    >
                        <span>↪</span>
                        Logout
                    </button>

                    <div className="user-area">
                        <div className="user-avatar">
                            M
                        </div>

                        <div>
                            <strong>
                                Manas
                            </strong>

                            <span>
                                PulseWatch user
                            </span>
                        </div>
                    </div>
                </div>
            </aside>

            <section className="dashboard-content">
                <header className="topbar">
                    <div className="search-box">
                        <span>⌕</span>

                        <input
                            id="monitor-search"
                            name="monitorSearch"
                            type="text"
                            placeholder="Search monitors, incidents..."
                        />
                    </div>

                    <div className="topbar-user">
                        <span
                            className={`realtime-status ${
                                socketConnected
                                    ? "connected"
                                    : "disconnected"
                            }`}
                        >
                            <span className="realtime-dot" />

                            {socketConnected
                                ? "Realtime connected"
                                : "Realtime disconnected"}
                        </span>

                        <span className="notification">
                            ♧
                        </span>

                        <div className="top-avatar">
                            M
                        </div>

                        <span>Manas</span>

                        <span>⌄</span>
                    </div>
                </header>

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

                        <button className="primary-button">
                            + Add Monitor
                        </button>
                    </div>

                    {error && (
                        <div className="dashboard-error">
                            {error}
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
                                {monitors.length}
                            </strong>
                        </div>

                        <div>
                            <span className="metric-label">
                                Healthy
                            </span>

                            <strong className="online-text">
                                {onlineCount}
                            </strong>
                        </div>

                        <div>
                            <span className="metric-label">
                                Degraded
                            </span>

                            <strong className="degraded-text">
                                {degradedCount}
                            </strong>
                        </div>

                        <div>
                            <span className="metric-label">
                                Down
                            </span>

                            <strong className="down-text">
                                {downCount}
                            </strong>
                        </div>

                        <div>
                            <span className="metric-label">
                                Incidents
                            </span>

                            <strong className="incident-text">
                                {
                                    activeIncidents.length
                                }
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
                                        {
                                            monitors.length
                                        }
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
                                                        <strong>
                                                            {
                                                                monitor.name
                                                            }
                                                        </strong>

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
                                            Last 20
                                            checks
                                        </span>
                                    </div>

                                    <p>
                                        Measured
                                        latency from
                                        real monitor
                                        checks.
                                    </p>
                                </div>

                                <span className="panel-note">
                                    Live
                                </span>
                            </div>

                            <div className="analysis-content">
                                <div className="analysis-chart">
                                    {chartData.length ===
                                    0 ? (
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
                                                    stroke="rgba(148, 163, 184, 0.10)"
                                                />

                                                <XAxis
                                                    dataKey="time"
                                                    tick={{
                                                        fill: "#71809a",
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
                                                    tick={{
                                                        fill: "#71809a",
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
                                                            "#0d1726",
                                                        border: "1px solid #25354d",
                                                        borderRadius:
                                                            "8px",
                                                        color: "#f8fafc",
                                                        boxShadow:
                                                            "0 12px 30px rgba(0,0,0,0.25)",
                                                    }}
                                                    labelStyle={{
                                                        color: "#94a3b8",
                                                        marginBottom:
                                                            "4px",
                                                    }}
                                                    formatter={(
                                                        value,
                                                        name
                                                    ) => {
                                                        const monitor =
                                                            monitors.find(
                                                                (
                                                                    item
                                                                ) =>
                                                                    `monitor_${item.id}` ===
                                                                    name
                                                            );

                                                        return [
                                                            `${value} ms`,
                                                            monitor?.name ??
                                                                name,
                                                        ];
                                                    }}
                                                />

                                                {monitors.map(
                                                    (
                                                        monitor,
                                                        index
                                                    ) => (
                                                        <Line
                                                            key={
                                                                monitor.id
                                                            }
                                                            type="monotone"
                                                            dataKey={`monitor_${monitor.id}`}
                                                            stroke={
                                                                chartColors[
                                                                    index %
                                                                        chartColors.length
                                                                ]
                                                            }
                                                            strokeWidth={
                                                                2.2
                                                            }
                                                            dot={
                                                                false
                                                            }
                                                            activeDot={{
                                                                r: 4,
                                                            }}
                                                            connectNulls={
                                                                true
                                                            }
                                                            animationDuration={
                                                                400
                                                            }
                                                        />
                                                    )
                                                )}
                                            </LineChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>

                                <div className="chart-legend">
                                    {monitors.map(
                                        (
                                            monitor,
                                            index
                                        ) => (
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
                                        Average
                                        current
                                        latency
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

                                    {activeIncidents.length >
                                        0 && (
                                        <span className="incident-counter">
                                            {
                                                activeIncidents.length
                                            }
                                        </span>
                                    )}
                                </div>

                                <div className="incident-list">
                                    {activeIncidents.length ===
                                    0 ? (
                                        <div className="no-incidents">
                                            <span className="healthy-check">
                                                ✓
                                            </span>

                                            <div>
                                                <strong>
                                                    No active
                                                    incidents
                                                </strong>

                                                <span>
                                                    All
                                                    monitored
                                                    services
                                                    are
                                                    operating
                                                    normally.
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
                                                        onClick={() =>
                                                            navigate(
                                                                "/incidents"
                                                            )
                                                        }
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
                                        Check
                                        interval
                                    </span>

                                    <strong>
                                        60 seconds
                                    </strong>
                                </div>

                                <div className="system-stat">
                                    <span>
                                        Active
                                        monitors
                                    </span>

                                    <strong>
                                        {
                                            monitors.filter(
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
                                        {
                                            activeIncidents.length
                                        }
                                    </strong>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </section>
        </main>
    );
}

export default Dashboard;