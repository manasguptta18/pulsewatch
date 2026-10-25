import jwt from "jsonwebtoken";
import type { Socket, Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import {
    createSocketAuthMiddleware,
    emitToUser,
    setSocketEventPublisher,
    userRoomId,
} from "./socket.js";

function runSocketAuth(token?: string, clientUserId?: number) {
    const socket = {
        handshake: {
            auth: {
                ...(token === undefined ? {} : { token }),
                ...(clientUserId === undefined ? {} : { userId: clientUserId }),
            },
            headers: {},
        },
        data: {},
    } as unknown as Socket;

    return new Promise<{
        error: Error | undefined;
        userId: number | undefined;
    }>((resolve) => {
        createSocketAuthMiddleware("socket-test-secret")(
            socket,
            (error) => resolve({ error, userId: socket.data.userId }),
        );
    });
}

describe("Socket.IO incident authorization", () => {
    it("rejects missing and invalid socket authentication", async () => {
        const missing = await runSocketAuth();
        const invalid = await runSocketAuth("not-a-valid-token");

        expect(missing.error).toBeInstanceOf(Error);
        expect(invalid.error).toBeInstanceOf(Error);
    });

    it("uses the verified JWT user ID and ignores client-supplied identity", async () => {
        const token = jwt.sign({ userId: 17 }, "socket-test-secret");
        const result = await runSocketAuth(token, 999);

        expect(result.error).toBeUndefined();
        expect(result.userId).toBe(17);

        const invalidIdentityToken = jwt.sign(
            { userId: "17" },
            "socket-test-secret",
        );
        expect((await runSocketAuth(invalidIdentityToken)).error).toBeInstanceOf(Error);
    });

    it.each(["incident:created", "incident:resolved", "monitor:updated"] as const)(
        "sends %s only to the verified owner's room",
        (event) => {
            const emit = vi.fn();
            const to = vi.fn(() => ({ emit }));
            const socketServer = { to } as unknown as Pick<Server, "to">;
            const payload = { incidentId: 41, monitorId: 12 };

            emitToUser(17, event, payload, socketServer);

            expect(userRoomId(17)).toBe("user:17");
            expect(to).toHaveBeenCalledExactlyOnceWith("user:17");
            expect(emit).toHaveBeenCalledExactlyOnceWith(event, payload);
        },
    );

    it.each(["incident:created", "incident:resolved", "monitor:updated"] as const)(
        "publishes worker %s events to only the owner room",
        (event) => {
            const publish = vi.fn();
            setSocketEventPublisher((room, publishedEvent, payload) => {
                publish(room, publishedEvent, payload);
            });

            try {
                const payload = { monitorId: 12 };
                emitToUser(17, event, payload, null);

                expect(publish).toHaveBeenCalledExactlyOnceWith(
                    "user:17",
                    event,
                    payload,
                );
            } finally {
                setSocketEventPublisher(null);
            }
        },
    );
});
