import express from "express";
import {prisma} from './lib/prisma.js';
const app = express();
import monitorRoutes from "./routes/monitor.routes.js";
import userRoutes from "./routes/user.routes.js";
import { startMonitorScheduler } from "./services/monitor.scheduler.js";
import incidentRoutes from "./routes/incident.routes.js"; 
import authRoutes from "./routes/auth.routes.js";

app.use(express.json());

app.get("/health", async (req,res)=>{
    const userCount = await prisma.user.count();  
    res.json({
        status: "ok",
        database: "connected",
        users: userCount,
    });
});

app.use("/api/v1/monitors",monitorRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/incidents", incidentRoutes);
app.use("/api/v1/auth",authRoutes);



const port = 3000;

app.get("/api/v1/test/slow", async (req, res) => {
    const delay = Number(req.query.delay ?? 100);

    await new Promise((resolve) => setTimeout(resolve, delay));

    res.json({
        message: `Response delayed by ${delay}ms`,
    });
});

app.listen(port, ()=>{
    console.log(`server running on port ${port}`);
});

startMonitorScheduler();