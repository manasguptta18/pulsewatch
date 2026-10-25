import { Router } from "express";

export const HEALTH_DEPENDENCY_TIMEOUT_MS = 1_500;

export type HealthDependencyStatus = "ok" | "unavailable" | "timeout";

export interface HealthDependencies {
    database: () => Promise<unknown>;
    redis: () => Promise<unknown>;
}

async function checkDependency(
    check: () => Promise<HealthDependencyStatus>,
    timeoutMs: number,
): Promise<HealthDependencyStatus> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Promise.resolve().then(check).catch(() => "unavailable" as const),
            new Promise<"timeout">((resolveTimeout) => {
                timer = setTimeout(() => resolveTimeout("timeout"), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function makeBoundedCheck(
    check: () => Promise<unknown>,
    timeoutMs: number,
): () => Promise<HealthDependencyStatus> {
    let pending: Promise<HealthDependencyStatus> | undefined;

    return () => {
        // A timed-out network operation cannot always be canceled. Share its
        // result until it settles so repeated probes do not pile up commands.
        pending ??= Promise.resolve()
            .then(check)
            .then(
                () => "ok" as const,
                () => "unavailable" as const,
            )
            .finally(() => { pending = undefined; });
        return checkDependency(() => pending!, timeoutMs);
    };
}

/** Create health routes with injected checks so tests never need live services. */
export function createHealthRouter(
    dependencies: HealthDependencies,
    timeoutMs = HEALTH_DEPENDENCY_TIMEOUT_MS,
) {
    const router = Router();
    const checkDatabase = makeBoundedCheck(dependencies.database, timeoutMs);
    const checkRedis = makeBoundedCheck(dependencies.redis, timeoutMs);

    router.get("/live", (_request, response) => {
        response.status(200).json({ status: "ok" });
    });

    const reportReadiness = async (_request: unknown, response: import("express").Response) => {
        const [database, redis] = await Promise.all([
            checkDatabase(),
            checkRedis(),
        ]);
        const ready = database === "ok" && redis === "ok";

        response.status(ready ? 200 : 503).json({
            status: ready ? "ready" : "not_ready",
            dependencies: { database, redis },
        });
    };

    // Keep /health as a compatibility alias for readiness while adding an
    // explicit path for load balancers and orchestrators.
    router.get("/", reportReadiness);
    router.get("/ready", reportReadiness);

    return router;
}
