import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim()
    || (import.meta.env.DEV ? "http://localhost:3000/api/v1" : "/api/v1");
export const API_ORIGIN = new URL(API_BASE_URL, window.location.origin).origin;
export const AUTH_UNAUTHORIZED_EVENT = "pulsewatch:unauthorized";

const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 20_000,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");

    if(token){
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            const requestUrl = error.config?.url ?? "";
            const isPublicAuthenticationRequest = /\/(auth\/login|users)\/?$/.test(requestUrl);
            const hasSession = localStorage.getItem("token") !== null;

            // A wrong password or registration error must not invalidate an
            // unrelated existing session. Other 401s mean the stored token is
            // no longer accepted by the API.
            if (!isPublicAuthenticationRequest && hasSession) {
                localStorage.removeItem("token");
                localStorage.removeItem("pulsewatch_user");
                window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
            }
        }

        return Promise.reject(error);
    },
);

export function getApiErrorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
            return "The request timed out; its result may be unknown. Refresh and check before retrying.";
        }
        const message = error.response?.data?.message;
        if (typeof message === "string" && message.trim()) return message;
        if (!error.response) return "Unable to connect to PulseWatch. Check your connection and try again.";
    }

    return fallback;
}

export default api;
