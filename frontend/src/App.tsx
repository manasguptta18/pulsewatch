import {
    BrowserRouter,
    Navigate,
    Route,
    Routes,
    useNavigate,
} from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "react-router-dom";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Monitors = lazy(() => import("./pages/Monitors"));
const MonitorDetails = lazy(() => import("./pages/MonitorDetails"));
const Incidents = lazy(() => import("./pages/Incidents"));
const Settings = lazy(() => import("./pages/Settings"));

import ProtectedRoute from "./components/ProtectedRoute";
import { AUTH_UNAUTHORIZED_EVENT } from "./services/api";
import { logoutUser } from "./services/auth.service";
import { connectSocket, disconnectSocket } from "./lib/socket";
import { watchThemePreference } from "./lib/theme";

function ThemeSync() {
    useEffect(watchThemePreference, []);
    return null;
}

function AuthSessionListener() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (localStorage.getItem("token")) {
            connectSocket();
        } else {
            disconnectSocket();
        }
    }, [location.pathname]);

    useEffect(() => {
        const handleUnauthorized = () => {
            logoutUser();
            navigate("/login", { replace: true, state: { sessionExpired: true } });
        };

        window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
        return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    }, [navigate]);

    return null;
}

function App() {
    return (
        <BrowserRouter>
            <ThemeSync />
            <AuthSessionListener />
            <Suspense fallback={<div className="route-loading" role="status">Loading PulseWatch…</div>}>
            <Routes>
                <Route
                    path="/"
                    element={
                        <Navigate
                            to={localStorage.getItem("token") ? "/dashboard" : "/login"}
                            replace
                        />
                    }
                />

                <Route
                    path="/login"
                    element={<Login />}
                />

                <Route
                    path="/dashboard"
                    element={
                        <ProtectedRoute>
                            <Dashboard />
                        </ProtectedRoute>
                    }
                />


                <Route
                    path="/monitors"
                    element={
                        <ProtectedRoute>
                            <Monitors />
                        </ProtectedRoute>
                    }
                />

                 <Route
                    path="/monitors/:id"
                    element={
                        <ProtectedRoute>
                            <MonitorDetails />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/settings"
                    element={
                        <ProtectedRoute>
                            <Settings />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/incidents"
                    element={
                        <ProtectedRoute>
                            <Incidents />
                        </ProtectedRoute>
                    }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
        </BrowserRouter>
    );
}

export default App;
