import type {Server as HttpServer} from "node:http";
import jwt from "jsonwebtoken";
import {Server, type Socket} from "socket.io";

let io: Server | null = null;

export function userRoomId(userId: number) {
    return `user:${userId}`;
}

export function createSocketAuthMiddleware(jwtSecret = process.env.JWT_SECRET) {
    return (socket: Socket, next: (error?: Error) => void) => {
        if (!jwtSecret) {
            next(new Error("Socket authentication unavailable"));
            return;
        }

        const authToken = socket.handshake.auth?.token;
        const authorization = socket.handshake.headers.authorization;
        const bearerToken = typeof authorization === "string" &&
            authorization.startsWith("Bearer ")
            ? authorization.slice("Bearer ".length)
            : undefined;
        const token = typeof authToken === "string" ? authToken : bearerToken;

        if (!token) {
            next(new Error("Authentication required"));
            return;
        }

        try {
            const decoded = jwt.verify(token, jwtSecret);
            if (
                typeof decoded !== "object" ||
                decoded === null ||
                !Number.isSafeInteger(decoded.userId) ||
                decoded.userId <= 0
            ) {
                next(new Error("Invalid socket authentication"));
                return;
            }

            socket.data.userId = decoded.userId;
            next();
        } catch {
            next(new Error("Invalid socket authentication"));
        }
    };
}

type UserEvent = "incident:created" | "incident:resolved" | "monitor:updated";
type RoomTarget = Pick<Server, "to">;

export function emitToUser(
    userId: number,
    event: UserEvent,
    payload: Record<string, unknown>,
    socketServer: RoomTarget | null = io,
) {
    socketServer?.to(userRoomId(userId)).emit(event, payload);
}

export function initializeSocket(httpServer: HttpServer){
    io = new Server(httpServer,{
        cors: {
            origin: "http://localhost:5173",
        },
    });

    io.use(createSocketAuthMiddleware());

    io.on("connection", (socket) => {
        socket.join(userRoomId(socket.data.userId));

        console.log(
            `Socket connected ${socket.id}`
        );

         socket.on("disconnect", () => {
            console.log(
                `Socket disconnected: ${socket.id}`
            );
        });
    });
    return io;
}

export function getIO(){
    return io;
}
