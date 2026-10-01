import { useState } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import { loginUser } from "../services/auth.service";
import "./Login.css";

function Login() {
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [showPassword, setShowPassword] =
        useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(
        event: SubmitEvent<HTMLFormElement>
    ) {
        event.preventDefault();

        setError("");
        setLoading(true);

        try {
            await loginUser({
                email,
                password,
            });

            navigate("/dashboard");
        } catch (error) {
            if (axios.isAxiosError(error)) {
                setError(
                    error.response?.data?.message ??
                        "Unable to connect to the server"
                );
            } else {
                setError("Something went wrong");
            }
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
                        <h1>Welcome back</h1>

                        <p className="login-subtitle">
                            Log in to your account to continue
                        </p>

                        <form
                            onSubmit={handleSubmit}
                            className="login-form"
                        >
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
                                    type="email"
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
                                    type={
                                        showPassword
                                            ? "text"
                                            : "password"
                                    }
                                    placeholder="Password"
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
                                <p className="login-error">
                                    {error}
                                </p>
                            )}

                            <button
                                type="submit"
                                className="login-button"
                                disabled={loading}
                            >
                                {loading
                                    ? "Logging in..."
                                    : "Login"}
                            </button>
                        </form>

                        <p className="signup-text">
                            Don't have an account?

                            <button
                                type="button"
                                className="signup-link"
                            >
                                Sign up
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