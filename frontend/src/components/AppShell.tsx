import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { getStoredUser, logoutUser } from "../services/auth.service";

type AppSection = "dashboard" | "monitors" | "incidents" | "settings";

type AppShellProps = {
    activeSection: AppSection;
    pageTitle: string;
    children: ReactNode;
    headerContent?: ReactNode;
    realtimeConnected?: boolean;
    incidentCount?: number;
};

function AppShell({
    activeSection,
    pageTitle,
    children,
    headerContent,
    realtimeConnected,
    incidentCount = 0,
}: AppShellProps) {
    const navigate = useNavigate();
    const user = getStoredUser();
    const initial = (user?.name?.trim()[0] ?? "P").toUpperCase();

    function navClass(section: AppSection) {
        return `app-nav-link${activeSection === section ? " active" : ""}`;
    }

    function handleLogout() {
        logoutUser();
        navigate("/login", { replace: true });
    }

    return (
        <div className="app-shell">
            <aside className="app-sidebar">
                <Link className="app-brand" to="/dashboard" aria-label="PulseWatch home">
                    <span className="app-brand-mark" aria-hidden="true">P</span>
                    <span>PulseWatch</span>
                </Link>

                <span className="app-nav-label">WORKSPACE</span>
                <nav className="app-nav" aria-label="Main navigation">
                    <NavLink to="/dashboard" className={navClass("dashboard")}>
                        <span className="app-nav-icon" aria-hidden="true">⌂</span>
                        <span>Overview</span>
                    </NavLink>
                    <NavLink to="/monitors" className={navClass("monitors")}>
                        <span className="app-nav-icon" aria-hidden="true">◉</span>
                        <span>Monitors</span>
                    </NavLink>
                    <NavLink to="/incidents" className={navClass("incidents")}>
                        <span className="app-nav-icon" aria-hidden="true">△</span>
                        <span>Incidents</span>
                        {incidentCount > 0 && <span className="app-nav-count">{incidentCount}</span>}
                    </NavLink>
                </nav>

                <div className="app-sidebar-bottom">
                    <NavLink to="/settings" className={navClass("settings")}>
                        <span className="app-nav-icon" aria-hidden="true">⚙</span>
                        <span>Settings</span>
                    </NavLink>
                    <button className="app-nav-link app-logout" type="button" onClick={handleLogout}>
                        <span className="app-nav-icon" aria-hidden="true">↪</span>
                        <span>Log out</span>
                    </button>
                    <div className="app-user-card">
                        <span className="app-avatar" aria-hidden="true">{initial}</span>
                        <span className="app-user-copy">
                            <strong>{user?.name ?? "PulseWatch user"}</strong>
                            <span>{user?.email ?? ""}</span>
                        </span>
                    </div>
                </div>
            </aside>

            <div className="app-main">
                <header className="app-topbar">
                    <div className="app-topbar-heading">
                        <span className="app-topbar-kicker">PULSEWATCH</span>
                        <h1>{pageTitle}</h1>
                    </div>
                    {headerContent && <div className="app-topbar-content">{headerContent}</div>}
                    <div className="app-topbar-status">
                        {realtimeConnected !== undefined && (
                            <span className={`app-realtime ${realtimeConnected ? "connected" : "disconnected"}`}>
                                <span aria-hidden="true" />
                                {realtimeConnected ? "Live updates on" : "Live updates offline"}
                            </span>
                        )}
                        <span className="app-avatar app-top-avatar" aria-hidden="true">{initial}</span>
                        <span className="app-top-user">{user?.name ?? "PulseWatch user"}</span>
                    </div>
                </header>
                <div className="app-page-content">{children}</div>
            </div>
        </div>
    );
}

export default AppShell;
