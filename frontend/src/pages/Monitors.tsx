import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";

import {
    connectSocket,
} from "../lib/socket";

import {
    createMonitor,
    getMonitors,
    type Monitor,
    withLatestCheck,
} from "../services/monitor.service";
import { getApiErrorMessage } from "../services/api";

import "./Monitors.css";

function Monitors() {
    const navigate = useNavigate();
    const location = useLocation();

    const [monitors, setMonitors] = useState<Monitor[]>(
        []
    );

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [currentTime, setCurrentTime] = useState(0);
    const [search, setSearch] = useState("");
    const [showCreateForm, setShowCreateForm] = useState(Boolean(location.state?.openCreate));
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [newUrl, setNewUrl] = useState("");

    useEffect(() => {
        if (location.state?.openCreate) navigate(location.pathname, { replace: true, state: null });
    }, [location.pathname, location.state, navigate]);

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

    async function handleCreateMonitor(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setCreating(true);
        setError("");
        try {
            const created = await createMonitor({ name: newName.trim(), url: newUrl.trim() });
            setMonitors((current) => [{ ...created, checks: [], incidents: [] }, ...current]);
            setShowCreateForm(false);
            setNewName("");
            setNewUrl("");
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, "Unable to create this monitor."));
        } finally {
            setCreating(false);
        }
    }

    useEffect(() => {
        const socket = connectSocket();
        const handleConnect = () => { void loadMonitors(); };

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

        function handleIncidentCreated(payload: {
            incidentId: number;
            monitorId: number;
            type: string;
            status: string;
            reason: string | null;
            startedAt: string;
        }) {
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
                            {
                                id: payload.incidentId,
                                type: payload.type,
                                status: payload.status,
                                reason: payload.reason,
                                startedAt:
                                    payload.startedAt,
                                resolvedAt: null,
                            },
                            ...monitor.incidents.filter((incident) => incident.id !== payload.incidentId),
                        ].slice(0, 20),
                    };
                })
            );
        }

        function handleIncidentResolved(payload: {
            incidentId: number;
            monitorId: number;
        }) {
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
        }

        socket.on("connect", handleConnect);
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

        return () => {
            socket.off("connect", handleConnect);
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
        const activeIncident = monitor.incidents[0];

        if (
            activeIncident?.type ===
            "PERFORMANCE"
        ) {
            return "DEGRADED";
        }

        if (
            latestCheck?.status ===
            "DOWN"
        ) {
            return "DOWN";
        }

        if (
            latestCheck?.status ===
            "UP"
        ) {
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

    function formatCheckedAt(monitor: Monitor) {
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

    const filteredMonitors = useMemo(() => {
        const query = search
            .trim()
            .toLowerCase();

        if (!query) {
            return monitors;
        }

        return monitors.filter(
            (monitor) =>
                monitor.name
                    .toLowerCase()
                    .includes(query) ||
                monitor.url
                    .toLowerCase()
                    .includes(query)
        );
    }, [monitors, search]);

    const healthyCount = monitors.filter(
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

    return (
        <AppShell
            activeSection="monitors"
            pageTitle="Monitors"
            headerContent={(
                <label className="monitors-search">
                    <span aria-hidden="true">⌕</span>
                    <span className="sr-only">Search monitors</span>
                    <input
                        id="monitor-page-search"
                        name="monitorPageSearch"
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search monitors or endpoints"
                    />
                </label>
            )}
        >
                <div className="monitors-main">
                    <div className="monitors-header">
                        <div>
                            <p className="eyebrow">
                                MONITORING
                            </p>

                            <h1>
                                Monitors
                            </h1>

                            <p className="header-description">
                                Manage and inspect
                                the health of every
                                API you are tracking.
                            </p>
                        </div>

                        <button
                            className="add-monitor-button"
                            type="button"
                            onClick={() => { setError(""); setShowCreateForm(true); }}
                        >
                            + Add Monitor
                        </button>
                    </div>

                    {showCreateForm && (
                        <form className="monitor-form-panel" onSubmit={handleCreateMonitor}>
                            <div className="monitor-form-heading">
                                <div>
                                    <h2>Add a monitor</h2>
                                    <p>The backend will use its default GET method and check interval.</p>
                                </div>
                                <button type="button" className="form-close" onClick={() => setShowCreateForm(false)} aria-label="Close form">×</button>
                            </div>
                            <label>
                                Monitor name
                                <input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={100} required />
                            </label>
                            <label>
                                Public HTTP or HTTPS URL
                                <input type="url" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} placeholder="https://status.example.com" required />
                            </label>
                            {error && <p className="form-error" role="alert">{error}</p>}
                            <div className="monitor-form-actions">
                                <button type="button" className="secondary-action" disabled={creating} onClick={() => setShowCreateForm(false)}>Cancel</button>
                                <button type="submit" className="primary-action" disabled={creating}>{creating ? "Creating…" : "Create monitor"}</button>
                            </div>
                        </form>
                    )}

                    {error && !showCreateForm && (
                        <div className="page-error">
                            <span role="alert">{error}</span>
                            <button type="button" onClick={() => void loadMonitors()}>Retry</button>
                        </div>
                    )}

                    <div className="monitor-summary">
                        <div className="summary-item">
                            <span>
                                Total
                            </span>

                            <strong>
                                {monitors.length}
                            </strong>
                        </div>

                        <div className="summary-item healthy">
                            <span>
                                Healthy
                            </span>

                            <strong>
                                {healthyCount}
                            </strong>
                        </div>

                        <div className="summary-item degraded">
                            <span>
                                Degraded
                            </span>

                            <strong>
                                {degradedCount}
                            </strong>
                        </div>

                        <div className="summary-item down">
                            <span>
                                Down
                            </span>

                            <strong>
                                {downCount}
                            </strong>
                        </div>
                    </div>

                    <section className="monitor-list-section">
                        <div className="list-heading">
                            <div>
                                <h2>
                                    All monitors
                                </h2>

                                <p>
                                    Live monitoring
                                    status and latest
                                    response data.
                                </p>
                            </div>

                            <span className="result-count">
                                {
                                    filteredMonitors.length
                                }{" "}
                                results
                            </span>
                        </div>

                        {loading ? (
                            <div className="empty-state">
                                Loading monitors...
                            </div>
                        ) : error && monitors.length === 0 ? (
                            <div className="empty-state">Could not load monitors. Use Retry above to try again.</div>
                        ) : filteredMonitors.length ===
                          0 ? (
                            <div className="empty-state">
                                <strong>
                                    {search
                                        ? "No matching monitors"
                                        : "No monitors configured"}
                                </strong>

                                <span>
                                    {search
                                        ? "Try a different monitor name or endpoint."
                                        : "Create your first monitor to start tracking an API."}
                                </span>
                            </div>
                        ) : (
                            <div className="monitor-cards">
                                {filteredMonitors.map(
                                    (
                                        monitor
                                    ) => {
                                        const status =
                                            getStatus(
                                                monitor
                                            );

                                        const activeIncident =
                                            monitor
                                                .incidents[0];

                                        return (
                                            <article
                                                className={`monitor-card ${status.toLowerCase()}`}
                                                key={
                                                    monitor.id
                                                }
                                            >
                                                <div className="monitor-card-main">
                                                    <div className="monitor-card-top">
                                                        <span
                                                            className={`status-badge ${status.toLowerCase()}`}
                                                        >
                                                            <span className="status-dot" />

                                                            {
                                                                status
                                                            }
                                                        </span>

                                                        <span className="monitor-method">
                                                            {
                                                                monitor.method
                                                            }
                                                        </span>
                                                    </div>

                                                    <div className="monitor-card-title">
                                                        <h3>
                                                            {
                                                                monitor.name
                                                            }
                                                        </h3>

                                                        <span>
                                                            ID #
                                                            {
                                                                monitor.id
                                                            }
                                                        </span>
                                                    </div>

                                                    <p className="monitor-url">
                                                        {
                                                            monitor.url
                                                        }
                                                    </p>

                                                    {activeIncident && (
                                                        <div className="active-incident">
                                                            <span className="incident-mark">
                                                                !
                                                            </span>

                                                            <div>
                                                                <strong>
                                                                    {
                                                                        activeIncident.type
                                                                    }{" "}
                                                                    incident
                                                                </strong>

                                                                <span>
                                                                    {
                                                                        activeIncident.reason ??
                                                                        "Active incident"
                                                                    }
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="monitor-card-metrics">
                                                    <div>
                                                        <span>
                                                            Latency
                                                        </span>

                                                        <strong>
                                                            {formatLatency(
                                                                monitor
                                                            )}
                                                        </strong>
                                                    </div>

                                                    <div>
                                                        <span>
                                                            HTTP
                                                        </span>

                                                        <strong>
                                                            {monitor
                                                                .checks[0]
                                                                ?.statusCode ??
                                                                "—"}
                                                        </strong>
                                                    </div>

                                                    <div>
                                                        <span>
                                                            Checked
                                                        </span>

                                                        <strong>
                                                            {formatCheckedAt(
                                                                monitor
                                                            )}
                                                        </strong>
                                                    </div>
                                                </div>

                                                <button
                                                    className="monitor-open"
                                                    type="button"
                                                    onClick={() => {
                                                        navigate(
                                                            `/monitors/${monitor.id}`
                                                        );
                                                    }}
                                                    aria-label={`Open ${monitor.name}`}
                                                >
                                                    →
                                                </button>
                                            </article>
                                        );
                                    }
                                )}
                            </div>
                        )}
                    </section>
                </div>
        </AppShell>
    );
}

export default Monitors;
