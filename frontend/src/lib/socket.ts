import {io, type Socket} from "socket.io-client";

let socket : Socket | null = null;

export function connectSocket(){
    if(!socket){
        socket = io("http://localhost:3000");
    }

    return socket;

}

export function disconnectSocket(){
        if(socket){
            socket.disconnect();
            socket = null;
        }
    }