import api from "./api";

type LoginData = {
    email: string;
    password: string;
};

export type SessionUser = {
    id: number;
    name: string;
    email: string;
};

type LoginResponse = {
    token: string;
    user: SessionUser;
};

export type RegistrationData = {
    name: string;
    email: string;
    password: string;
};

export type RegistrationResponse = SessionUser & { createdAt: string };

export async function loginUser(
    data: LoginData
): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>(
        "/auth/login",
        data
    );

    localStorage.setItem(
        "token",
        response.data.token
    );
    localStorage.setItem("pulsewatch_user", JSON.stringify(response.data.user));

    return response.data;
}

export async function registerUser(data: RegistrationData): Promise<RegistrationResponse> {
    const response = await api.post<RegistrationResponse>("/users", data);
    return response.data;
}

export function getStoredUser(): SessionUser | null {
    const stored = localStorage.getItem("pulsewatch_user");
    if (!stored) return null;

    try {
        const user: unknown = JSON.parse(stored);
        if (
            typeof user === "object" && user !== null &&
            "id" in user && typeof user.id === "number" && Number.isSafeInteger(user.id) &&
            "name" in user && typeof user.name === "string" &&
            "email" in user && typeof user.email === "string"
        ) {
            return { id: user.id, name: user.name, email: user.email };
        }
    } catch {
        // Ignore stale or malformed browser storage and use the safe fallback.
    }

    localStorage.removeItem("pulsewatch_user");
    return null;
}

export function logoutUser() {
    localStorage.removeItem("token");
    localStorage.removeItem("pulsewatch_user");
}

export async function changePassword(data: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
}): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>("/users/me/password", data);
    return response.data;
}
