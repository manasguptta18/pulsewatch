import {app} from "./app.js";
import { startMonitorScheduler } from "./services/monitor.scheduler.js";
import { createServer } from "node:http";
import { initializeSocket } from "./lib/socket.js";

const port = 3000;

const httpServer = createServer(app);
initializeSocket(httpServer);

httpServer.listen(port, ()=>{
    console.log(`server running on port ${port}`);
});

startMonitorScheduler();