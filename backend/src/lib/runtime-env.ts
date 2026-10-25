import { validateRedisUrl } from "./redis.js";

type RuntimeKind = "api" | "worker";
type RuntimeEnvironment = Record<string, string | undefined>;

function requiredValue(name: string, value: string | undefined): string {
    if (!value || value.trim().length === 0) {
        throw new Error(`${name} is required`);
    }
    return value;
}

function validateDatabaseUrl(value: string): void {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
    }

    if (
        (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
        !parsed.hostname
    ) {
        throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
    }
}

/** Return a validated allowlist for browser HTTP and Socket.IO requests. */
export function getAllowedFrontendOrigins(
    environment: RuntimeEnvironment = process.env,
): string[] {
    const configured = environment.FRONTEND_ORIGIN;
    if (configured === undefined || configured.trim() === "") {
        return ["http://localhost:5173"];
    }

    const values = configured.split(",").map((origin) => origin.trim());
    if (values.some((origin) => origin.length === 0)) {
        throw new Error("FRONTEND_ORIGIN must contain valid HTTP or HTTPS origins");
    }

    try {
        return values.map((origin) => {
            const parsed = new URL(origin);
            if (
                (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
                !parsed.hostname ||
                parsed.username ||
                parsed.password ||
                parsed.pathname !== "/" ||
                parsed.search ||
                parsed.hash
            ) {
                throw new Error("Invalid origin");
            }
            return parsed.origin;
        });
    } catch {
        throw new Error("FRONTEND_ORIGIN must contain valid HTTP or HTTPS origins");
    }
}

export function parseApiPort(value: string | undefined): number {
    if (value === undefined) return 3000;
    if (!/^[1-9]\d*$/.test(value)) throw new Error("PORT must be an integer from 1 to 65535");
    const port = Number(value);
    if (!Number.isSafeInteger(port) || port > 65_535) {
        throw new Error("PORT must be an integer from 1 to 65535");
    }
    return port;
}

export function parseTrustedProxyHops(value: string | undefined): number {
    if (value === undefined) return 0;
    if (!/^\d+$/.test(value)) throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 10");
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops > 10) {
        throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 10");
    }
    return hops;
}

/** Validate required process configuration without including values in errors. */
export function validateRuntimeEnvironment(
    kind: RuntimeKind,
    environment: RuntimeEnvironment = process.env,
): void {
    const databaseUrl = requiredValue("DATABASE_URL", environment.DATABASE_URL);
    validateDatabaseUrl(databaseUrl);

    const redisUrl = requiredValue("REDIS_URL", environment.REDIS_URL);
    validateRedisUrl(redisUrl);

    if (kind === "api") {
        const jwtSecret = requiredValue("JWT_SECRET", environment.JWT_SECRET);
        if (Buffer.byteLength(jwtSecret, "utf8") < 32) {
            throw new Error("JWT_SECRET must be at least 32 UTF-8 bytes");
        }
        getAllowedFrontendOrigins(environment);
        parseApiPort(environment.PORT);
        parseTrustedProxyHops(environment.TRUST_PROXY_HOPS);
    }
}
