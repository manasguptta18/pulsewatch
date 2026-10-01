import api from "./api";

type LoginData = {
    email: string;
    password: string;
};

type LoginResponse = {
    token: string;
    user: {
        id: number;
        name: string;
        email: string;
    };
};

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

    return response.data;
}

export function logoutUser() {
    localStorage.removeItem("token");
}