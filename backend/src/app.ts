import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";

import monitorRoutes from "./routes/monitor.routes.js";
import userRoutes from "./routes/user.routes.js";
import incidentRoutes from "./routes/incident.routes.js";
import authRoutes from "./routes/auth.routes.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { errorMiddleware, notFoundMiddleware } from "./middleware/error.middleware.js";
import { getRedisConnection } from "./lib/redis.js";
import { getAllowedFrontendOrigins, parseTrustedProxyHops } from "./lib/runtime-env.js";

const app = express();
const trustedProxyHops = parseTrustedProxyHops(process.env.TRUST_PROXY_HOPS);
if (trustedProxyHops > 0) app.set("trust proxy", trustedProxyHops);

app.use(
    cors({
        origin: getAllowedFrontendOrigins(),
    })
);

app.use(express.json({ limit: "32kb" }));

app.use("/health", createHealthRouter({
    database: () => prisma.$queryRaw`SELECT 1`,
    redis: () => getRedisConnection().ping(),
}));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/monitors", monitorRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/incidents", incidentRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export { app };
