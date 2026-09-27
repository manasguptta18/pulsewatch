import express from "express";
import { prisma } from "./lib/prisma.js";

import monitorRoutes from "./routes/monitor.routes.js";
import userRoutes from "./routes/user.routes.js";
import incidentRoutes from "./routes/incident.routes.js";
import authRoutes from "./routes/auth.routes.js";

const app = express();

app.use(express.json());

app.get("/health", async (req, res) => {
    const userCount = await prisma.user.count();

    res.json({
        status: "ok",
        database: "connected",
        users: userCount,
    });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/monitors", monitorRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/incidents", incidentRoutes);

app.get("/api/v1/test/slow", async (req, res) => {
    const delay = Number(req.query.delay ?? 100);

    await new Promise((resolve) =>
        setTimeout(resolve, delay)
    );

    res.json({
        message: `Response delayed by ${delay}ms`,
    });
});

export { app };