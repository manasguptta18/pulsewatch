import { io, type Socket } from "socket.io-client";
import { API_ORIGIN, AUTH_UNAUTHORIZED_EVENT } from "../services/api";
import { logoutUser } from "../services/auth.service";

let socket: Socket | null = null;
let socketToken: string | null = null;

export function connectSocket(): Socket {
    const token = localStorage.getItem("token");
    if (socket && socketToken !== token) {
        socket.disconnect();
        socket = null;
    }

    if (!socket) {
        socketToken = token;
        socket = io(API_ORIGIN, {
            auth: (callback) => callback({ token: localStorage.getItem("token") }),
            reconnection: true,
        });

        socket.on("connect_error", (error: Error) => {
            if (/authentication|required|token/i.test(error.message)) {
                logoutUser();
                window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
            }
        });
    }

    return socket;
}

export function disconnectSocket(): void {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    socketToken = null;
}
