export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "pulsewatch_theme";
const THEME_CHANGED_EVENT = "pulsewatch:theme-changed";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePreference(): ThemePreference {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "system" ? stored : "light";
}

export function applyStoredTheme(): void {
    const preference = getThemePreference();
    document.documentElement.dataset.theme =
        preference === "system" ? (systemDark.matches ? "dark" : "light") : preference;
}

export function setThemePreference(preference: ThemePreference): void {
    localStorage.setItem(STORAGE_KEY, preference);
    applyStoredTheme();
    window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}

export function watchThemePreference(): () => void {
    const update = () => applyStoredTheme();
    systemDark.addEventListener("change", update);
    window.addEventListener("storage", update);
    window.addEventListener(THEME_CHANGED_EVENT, update);
    update();
    return () => {
        systemDark.removeEventListener("change", update);
        window.removeEventListener("storage", update);
        window.removeEventListener(THEME_CHANGED_EVENT, update);
    };
}
