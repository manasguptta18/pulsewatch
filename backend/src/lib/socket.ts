import type {Server as HttpServer} from "node:http";
import {Server} from "socket.io";

let io: Server | null = null;

export function initializeSocket(httpServer: HttpServer){
    io = new Server(httpServer,{
        cors: {
            origin: "http://localhost:5173",
        },
    });

    io.on("connection", (socket) => {
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