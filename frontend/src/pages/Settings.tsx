import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { changePassword, getStoredUser, logoutUser } from "../services/auth.service";
import { getApiErrorMessage } from "../services/api";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";

import "./Settings.css";

function Settings() {
    const navigate = useNavigate();

    const [activeSection, setActiveSection] =
        useState("Profile");

    const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [changingPassword, setChangingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState("");
    const [passwordSuccess, setPasswordSuccess] = useState("");
    const passwordRequestInFlight = useRef(false);
    const user = getStoredUser();

    useEffect(() => {
        const syncTheme = () => setTheme(getThemePreference());
        window.addEventListener("storage", syncTheme);
        return () => window.removeEventListener("storage", syncTheme);
    }, []);

    function handleLogout() {
        logoutUser();
        navigate("/login", { replace: true });
    }

    async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (passwordRequestInFlight.current) return;
        setPasswordError("");
        setPasswordSuccess("");
        if (newPassword !== confirmPassword) {
            setPasswordError("New password and confirmation do not match.");
            return;
        }
        if (newPassword === currentPassword) {
            setPasswordError("Choose a new password that differs from your current password.");
            return;
        }
        if (new TextEncoder().encode(newPassword).length > 72) {
            setPasswordError("Password must be at most 72 UTF-8 bytes.");
            return;
        }

        passwordRequestInFlight.current = true;
        setChangingPassword(true);
        try {
            const result = await changePassword({ currentPassword, newPassword, confirmPassword });
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setPasswordSuccess(`${result.message}. You remain signed in.`);
        } catch (requestError) {
            setPasswordError(getApiErrorMessage(requestError, "Unable to update your password."));
        } finally {
            passwordRequestInFlight.current = false;
            setChangingPassword(false);
        }
    }

    const sections = [
        "Profile",
        "Notifications",
        "API Keys",
        "Team",
        "Danger Zone",
    ];

    return (
        <AppShell
            activeSection="settings"
            pageTitle="Settings"
            headerContent={<span className="settings-breadcrumb">Settings <span aria-hidden="true">/</span> {activeSection}</span>}
        >
                <div className="settings-main">
                    <div className="settings-header">
                        <div>
                            <p className="settings-eyebrow">
                                ACCOUNT
                            </p>

                            <h1>Settings</h1>

                            <p>
                                Manage your account
                                and preferences.
                            </p>
                        </div>
                    </div>

                    <div className="settings-layout">
                        <aside className="settings-menu">
                            {sections.map(
                                (section) => (
                                    <button
                                        key={section}
                                        className={`settings-menu-item ${
                                            activeSection ===
                                            section
                                                ? "active"
                                                : ""
                                        }`}
                                        onClick={() =>
                                            setActiveSection(
                                                section
                                            )
                                        }
                                    >
                                        <span>
                                            {section ===
                                            "Profile"
                                                ? "♙"
                                                : section ===
                                                    "Notifications"
                                                  ? "♧"
                                                  : section ===
                                                      "API Keys"
                                                    ? "⌘"
                                                    : section ===
                                                        "Team"
                                                      ? "♙"
                                                      : "!"
                                            }
                                        </span>

                                        {section}
                                    </button>
                                )
                            )}
                        </aside>

                        <section className="settings-panel">
                            {activeSection ===
                                "Profile" && (
                                <>
                                    <div className="panel-header">
                                        <div>
                                            <h2>
                                                Profile
                                                Information
                                            </h2>

                                            <p>
                                                Manage
                                                your
                                                personal
                                                account
                                                information.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="profile-form">
                                        <div className="form-field">
                                            <label htmlFor="settings-name">
                                                Name
                                            </label>

                                            <input
                                                id="settings-name"
                                                name="name"
                                                type="text"
                                                value={user?.name ?? ""}
                                                readOnly
                                            />
                                        </div>

                                        <div className="form-field">
                                            <label htmlFor="settings-email">
                                                Email
                                            </label>

                                            <input
                                                id="settings-email"
                                                name="email"
                                                type="email"
                                                value={user?.email ?? ""}
                                                readOnly
                                            />
                                        </div>

                                        <div className="password-section">
                                            <div>
                                                <h3>
                                                    Password
                                                </h3>

                                                <p>
                                                    Change
                                                    your
                                                    account
                                                    password.
                                                </p>
                                            </div>
                                        </div>
                                        <form className="password-form" onSubmit={(event) => void handlePasswordChange(event)}>
                                            <div className="form-field">
                                                <label htmlFor="settings-current-password">Current password</label>
                                                <input id="settings-current-password" type="password" autoComplete="current-password"
                                                    value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)}
                                                    minLength={8} maxLength={100} required />
                                            </div>
                                            <div className="form-field">
                                                <label htmlFor="settings-new-password">New password</label>
                                                <input id="settings-new-password" type="password" autoComplete="new-password"
                                                    value={newPassword} onChange={(event) => setNewPassword(event.target.value)}
                                                    minLength={8} maxLength={100} required />
                                            </div>
                                            <div className="form-field">
                                                <label htmlFor="settings-confirm-password">Confirm new password</label>
                                                <input id="settings-confirm-password" type="password" autoComplete="new-password"
                                                    value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
                                                    minLength={8} maxLength={100} required />
                                            </div>
                                            <button className="secondary-button" type="submit" disabled={changingPassword}>
                                                {changingPassword ? "Updating…" : "Update Password"}
                                            </button>
                                            {passwordError && <p className="password-feedback error" role="alert">{passwordError}</p>}
                                            {passwordSuccess && <p className="password-feedback success" role="status">{passwordSuccess}</p>}
                                        </form>
                                    </div>

                                    <div className="theme-section">
                                        <div>
                                            <h3>
                                                Theme
                                            </h3>

                                            <p>
                                                Choose how PulseWatch appears on this device.
                                            </p>
                                        </div>

                                        <div className="theme-options">
                                            {(["dark", "light", "system"] as const).map(
                                                (
                                                    option
                                                ) => (
                                                    <button
                                                        key={
                                                            option
                                                        }
                                                        type="button"
                                                        className={`theme-option ${
                                                            theme ===
                                                            option
                                                                ? "active"
                                                                : ""
                                                        }`}
                                                        aria-pressed={theme === option}
                                                        onClick={() => {
                                                            setThemePreference(option);
                                                            setTheme(option);
                                                        }}
                                                    >
                                                        <span>
                                                            {option ===
                                                            "dark"
                                                                ? "◐"
                                                                : option ===
                                                                    "light"
                                                                  ? "○"
                                                                  : "◌"}
                                                        </span>

                                                        {
                                                            option[0].toUpperCase() + option.slice(1)
                                                        }
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}

                            {activeSection ===
                                "Notifications" && (
                                <div className="placeholder-section">
                                    <div className="placeholder-icon">
                                        ♧
                                    </div>

                                    <h2>
                                        Notifications
                                    </h2>

                                    <p>
                                        Notification
                                        preferences
                                        will be
                                        available
                                        here.
                                    </p>
                                </div>
                            )}

                            {activeSection ===
                                "API Keys" && (
                                <div className="placeholder-section">
                                    <div className="placeholder-icon">
                                        ⌘
                                    </div>

                                    <h2>
                                        API Keys
                                    </h2>

                                    <p>
                                        API key
                                        management
                                        will be
                                        available
                                        here.
                                    </p>
                                </div>
                            )}

                            {activeSection ===
                                "Team" && (
                                <div className="placeholder-section">
                                    <div className="placeholder-icon">
                                        ♙
                                    </div>

                                    <h2>
                                        Team
                                    </h2>

                                    <p>
                                        Team
                                        management
                                        will be
                                        available
                                        here.
                                    </p>
                                </div>
                            )}

                            {activeSection ===
                                "Danger Zone" && (
                                <div className="danger-section">
                                    <div>
                                        <p className="danger-eyebrow">
                                            DANGER ZONE
                                        </p>

                                        <h2>
                                            Account
                                            actions
                                        </h2>

                                        <p>
                                            These actions
                                            affect your
                                            PulseWatch
                                            session.
                                        </p>
                                    </div>

                                    <button
                                        className="danger-button"
                                        type="button"
                                        onClick={
                                            handleLogout
                                        }
                                    >
                                        Logout from
                                        this device
                                    </button>
                                </div>
                            )}
                        </section>
                    </div>
                </div>
        </AppShell>
    );
}

export default Settings;
