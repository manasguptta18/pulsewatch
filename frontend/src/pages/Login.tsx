import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { getApiErrorMessage } from "../services/api";
import { loginUser, registerUser } from "../services/auth.service";
import "./Login.css";

function Login() {
    const navigate = useNavigate();
    const location = useLocation();

    const [mode, setMode] = useState<"login" | "register">("login");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [showPassword, setShowPassword] =
        useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    async function handleSubmit(
        event: FormEvent<HTMLFormElement>
    ) {
        event.preventDefault();

        setError("");
        setSuccess("");
        setLoading(true);

        try {
            if (mode === "register") {
                if (new TextEncoder().encode(password).length > 72) {
                    setError("Password must be no more than 72 UTF-8 bytes.");
                    return;
                }
                await registerUser({ name, email, password });
                setMode("login");
                setName("");
                setPassword("");
                setSuccess("Account created. Log in with your new credentials.");
            } else {
                await loginUser({ email, password });
                navigate("/dashboard", { replace: true });
            }
        } catch (requestError) {
            setError(getApiErrorMessage(
                requestError,
                mode === "login" ? "Unable to log in." : "Unable to create your account.",
            ));
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="login-page">
            <section className="login-shell">
                {/* LEFT SIDE */}
                <div className="login-panel">
                    <div className="brand">
                        <div className="brand-icon">
                            〰
                        </div>

                        <span>PulseWatch</span>
                    </div>

                    <p className="tagline">
                        Monitor. Detect. Understand.
                    </p>

                    <div className="login-card">
                        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>

                        <p className="login-subtitle">
                            {mode === "login"
                                ? "Log in to your account to continue"
                                : "Create a PulseWatch account to get started"}
                        </p>

                        {location.state?.sessionExpired && mode === "login" && (
                            <p className="login-notice" role="status">Your session expired. Please log in again.</p>
                        )}

                        <form
                            onSubmit={handleSubmit}
                            className="login-form"
                        >
                            {mode === "register" && (
                                <div className="input-wrapper">
                                    <label htmlFor="name" className="sr-only">Name</label>
                                    <input
                                        id="name"
                                        name="name"
                                        type="text"
                                        autoComplete="name"
                                        placeholder="Your name"
                                        value={name}
                                        maxLength={100}
                                        onChange={(event) => setName(event.target.value)}
                                        required
                                    />
                                </div>
                            )}
                            <label
                                htmlFor="email"
                                className="sr-only"
                            >
                                Email
                            </label>

                            <div className="input-wrapper">
                                <span className="input-icon">
                                    @
                                </span>

                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={(event) =>
                                        setEmail(
                                            event.target.value
                                        )
                                    }
                                    required
                                />
                            </div>

                            <label
                                htmlFor="password"
                                className="sr-only"
                            >
                                Password
                            </label>

                            <div className="input-wrapper">
                                <span className="input-icon">
                                    ◈
                                </span>

                                <input
                                    id="password"
                                    name="password"
                                    type={
                                        showPassword
                                            ? "text"
                                            : "password"
                                    }
                                    placeholder="Password"
                                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                                    minLength={8}
                                    maxLength={100}
                                    value={password}
                                    onChange={(event) =>
                                        setPassword(
                                            event.target.value
                                        )
                                    }
                                    required
                                />

                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() =>
                                        setShowPassword(
                                            (current) =>
                                                !current
                                        )
                                    }
                                    aria-label={
                                        showPassword
                                            ? "Hide password"
                                            : "Show password"
                                    }
                                >
                                    {showPassword
                                        ? "◉"
                                        : "◌"}
                                </button>
                            </div>

                            {error && (
                                <p className="login-error" role="alert">
                                    {error}
                                </p>
                            )}
                            {success && <p className="login-success" role="status">{success}</p>}

                            <button
                                type="submit"
                                className="login-button"
                                disabled={loading}
                            >
                                {loading
                                    ? mode === "login" ? "Logging in..." : "Creating account..."
                                    : mode === "login" ? "Login" : "Create account"}
                            </button>
                        </form>

                        <p className="signup-text">
                            <button
                                type="button"
                                className="signup-link"
                                onClick={() => {
                                    setMode((current) => current === "login" ? "register" : "login");
                                    setError("");
                                    setSuccess("");
                                }}
                            >
                                {mode === "login" ? "Create an account" : "Back to login"}
                            </button>
                        </p>
                    </div>
                </div>

                {/* RIGHT SIDE */}
                <div
                    className="visual-panel"
                    aria-label="PulseWatch mountain illustration"
                />
            </section>
        </main>
    );
}

export default Login;
