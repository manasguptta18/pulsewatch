import type {Server as HttpServer} from "node:http";
import jwt from "jsonwebtoken";
import {createAdapter} from "@socket.io/redis-adapter";
import {Server, type Socket} from "socket.io";
import {closeRedisClient, getRedisConnection} from "./redis.js";
import { getAllowedFrontendOrigins } from "./runtime-env.js";
import { safeErrorDetails } from "./safe-error.js";

let io: Server | null = null;
let socketAdapterSubscriber: ReturnType<typeof getRedisConnection> | undefined;

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
            const decoded = jwt.verify(token, jwtSecret, {
                algorithms: ["HS256"],
            });
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

export type UserEvent = "incident:created" | "incident:resolved" | "monitor:updated";
type RoomTarget = Pick<Server, "to">;
type SocketEventPublisher = (
    room: string,
    event: UserEvent,
    payload: Record<string, unknown>,
) => void;

let processEventPublisher: SocketEventPublisher | null = null;

/** Configure a process-local publisher, used by workers without a Socket.IO server. */
export function setSocketEventPublisher(publisher: SocketEventPublisher | null) {
    processEventPublisher = publisher;
}

export function emitToUser(
    userId: number,
    event: UserEvent,
    payload: Record<string, unknown>,
    socketServer: RoomTarget | null = io,
) {
    const room = userRoomId(userId);
    if (socketServer) {
        socketServer.to(room).emit(event, payload);
        return;
    }

    processEventPublisher?.(room, event, payload);
}

export function initializeSocket(httpServer: HttpServer){
    const publisher = getRedisConnection();
    const subscriber = publisher.duplicate();
    subscriber.on("error", (error) => {
        console.error("Socket.IO Redis subscriber connection error", safeErrorDetails(error));
    });
    socketAdapterSubscriber = subscriber;

    io = new Server(httpServer,{
        cors: {
            origin: getAllowedFrontendOrigins(),
        },
    });

    // The adapter forwards room-targeted events between API processes. Workers
    // publish to the same Redis channels through @socket.io/redis-emitter.
    io.adapter(createAdapter(publisher, subscriber));

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

/** Close only the API process's Socket.IO Redis subscriber. */
export async function closeSocketAdapter(): Promise<void> {
    if (!socketAdapterSubscriber) return;

    const subscriber = socketAdapterSubscriber;
    socketAdapterSubscriber = undefined;
    await closeRedisClient(subscriber);
}

export function getIO(){
    return io;
}
