import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { getApiErrorMessage } from "../services/api";
import {
    getIncidents,
    type IncidentListItem,
} from "../services/incident.service";
import "./Incidents.css";

type StatusFilter = "ALL" | IncidentListItem["status"];
type TypeFilter = "ALL" | IncidentListItem["type"];

function displayDate(value: string | null) {
    if (!value) return "Not resolved";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function Incidents() {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
    const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
    const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
    const [nextCursor, setNextCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");
    const [refresh, setRefresh] = useState(0);
    const requestId = useRef(0);
    const pageInFlight = useRef(false);

    function resetForRequest() {
        requestId.current += 1;
        pageInFlight.current = false;
        setLoading(true);
        setLoadingMore(false);
        setIncidents([]);
        setNextCursor(null);
        setError("");
    }

    useEffect(() => {
        const currentRequest = ++requestId.current;
        void getIncidents({
            limit: 20,
            ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
            ...(typeFilter !== "ALL" ? { type: typeFilter } : {}),
        }).then((page) => {
            if (currentRequest !== requestId.current) return;
            setIncidents(page.incidents);
            setNextCursor(page.hasMore ? page.nextCursor : null);
        }).catch((requestError: unknown) => {
            if (currentRequest !== requestId.current) return;
            setError(getApiErrorMessage(requestError, "Unable to load incidents."));
        }).finally(() => {
            if (currentRequest === requestId.current) setLoading(false);
        });
        return () => { requestId.current += 1; };
    }, [statusFilter, typeFilter, refresh]);

    async function loadMore() {
        if (pageInFlight.current || nextCursor === null) return;
        pageInFlight.current = true;
        const currentRequest = requestId.current;
        setLoadingMore(true);
        setError("");
        try {
            const page = await getIncidents({
                limit: 20,
                after: nextCursor,
                ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
                ...(typeFilter !== "ALL" ? { type: typeFilter } : {}),
            });
            if (currentRequest !== requestId.current) return;
            setIncidents((current) => [
                ...current,
                ...page.incidents.filter((incident) => !current.some((item) => item.id === incident.id)),
            ]);
            setNextCursor(page.hasMore ? page.nextCursor : null);
        } catch (requestError) {
            if (currentRequest === requestId.current) {
                setError(getApiErrorMessage(requestError, "Unable to load more incidents."));
            }
        } finally {
            if (currentRequest === requestId.current) {
                pageInFlight.current = false;
                setLoadingMore(false);
            }
        }
    }

    return (
        <AppShell activeSection="incidents" pageTitle="Incidents">
            <main className="incidents-main">
                <header className="incidents-header">
                    <div>
                        <p className="eyebrow">INCIDENT HISTORY</p>
                        <h1>Incidents</h1>
                        <p>Availability and performance events from your monitors.</p>
                    </div>
                </header>

                <div className="incident-filters" aria-label="Filter incidents">
                    <label htmlFor="incident-status-filter">Status
                        <select id="incident-status-filter" value={statusFilter}
                            onChange={(event) => {
                                resetForRequest();
                                setStatusFilter(event.target.value as StatusFilter);
                            }}>
                            <option value="ALL">All statuses</option>
                            <option value="ONGOING">Ongoing</option>
                            <option value="RESOLVED">Resolved</option>
                        </select>
                    </label>
                    <label htmlFor="incident-type-filter">Type
                        <select id="incident-type-filter" value={typeFilter}
                            onChange={(event) => {
                                resetForRequest();
                                setTypeFilter(event.target.value as TypeFilter);
                            }}>
                            <option value="ALL">All types</option>
                            <option value="AVAILABILITY">Availability</option>
                            <option value="PERFORMANCE">Performance</option>
                        </select>
                    </label>
                </div>

                {error && (
                    <div className="incident-list-error" role="alert">
                        <span>{error}</span>
                        <button type="button" onClick={() => {
                            if (incidents.length > 0) void loadMore();
                            else {
                                resetForRequest();
                                setRefresh((value) => value + 1);
                            }
                        }}>
                            Retry
                        </button>
                    </div>
                )}

                <section className="incident-list-panel" aria-label="Incident results">
                    {loading ? (
                        <div className="incident-list-state" role="status">Loading incidents…</div>
                    ) : incidents.length === 0 ? (
                        <div className="incident-list-state">
                            <strong>{error ? "Incident data unavailable" : "No incidents found"}</strong>
                            <span>{error
                                ? "Retry when the API is available."
                                : statusFilter === "ALL" && typeFilter === "ALL"
                                    ? "Incidents will appear here when a monitor detects an issue."
                                    : "Try another status or type filter."}</span>
                        </div>
                    ) : (
                        <div className="incident-list-items">
                            {incidents.map((incident) => (
                                <article className="incident-list-row" key={incident.id}>
                                    <div className="incident-list-main">
                                        <div className="incident-list-title">
                                            <span className={`incident-type-dot ${incident.type.toLowerCase()}`} aria-hidden="true" />
                                            <strong>{incident.type === "AVAILABILITY" ? "Availability" : "Performance"}</strong>
                                            <span className={`incident-status ${incident.status.toLowerCase()}`}>
                                                {incident.status === "ONGOING" ? "Ongoing" : "Resolved"}
                                            </span>
                                        </div>
                                        <p>{incident.reason ?? "No reason recorded"}</p>
                                        <Link to={`/monitors/${incident.monitorId}`}>{incident.monitor.name}</Link>
                                    </div>
                                    <div className="incident-list-times">
                                        <span>Started <time dateTime={incident.startedAt}>{displayDate(incident.startedAt)}</time></span>
                                        <span>Resolved <time dateTime={incident.resolvedAt ?? undefined}>{displayDate(incident.resolvedAt)}</time></span>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
                {nextCursor !== null && !loading && (
                    <button className="incident-load-more" type="button" disabled={loadingMore}
                        onClick={() => void loadMore()}>
                        {loadingMore ? "Loading…" : "Load more incidents"}
                    </button>
                )}
            </main>
        </AppShell>
    );
}

export default Incidents;
