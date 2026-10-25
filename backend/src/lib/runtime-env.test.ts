import { describe, expect, it } from "vitest";
import {
    getAllowedFrontendOrigins,
    parseApiPort,
    parseTrustedProxyHops,
    validateRuntimeEnvironment,
} from "./runtime-env.js";

const baseEnvironment = {
    DATABASE_URL: "postgresql://pulsewatch:test@localhost:5432/pulsewatch",
    REDIS_URL: "redis://localhost:6379/0",
};

describe("validateRuntimeEnvironment", () => {
    it("accepts API configuration when all required values are present", () => {
        expect(() => validateRuntimeEnvironment("api", {
            ...baseEnvironment,
            JWT_SECRET: "test-secret-that-is-at-least-32-bytes",
        })).not.toThrow();
    });

    it("rejects short JWT secrets without exposing the configured value", () => {
        expect(() => validateRuntimeEnvironment("api", {
            ...baseEnvironment,
            JWT_SECRET: "too-short-secret",
        })).toThrow("JWT_SECRET must be at least 32 UTF-8 bytes");
    });

    it("does not require JWT configuration for the worker", () => {
        expect(() => validateRuntimeEnvironment("worker", baseEnvironment)).not.toThrow();
    });

    it.each([
        ["DATABASE_URL", { ...baseEnvironment, DATABASE_URL: undefined }],
        ["REDIS_URL", { ...baseEnvironment, REDIS_URL: undefined }],
        ["JWT_SECRET", { ...baseEnvironment, JWT_SECRET: " " }],
    ])("reports missing or blank %s without exposing configuration", (name, environment) => {
        expect(() => validateRuntimeEnvironment("api", environment))
            .toThrow(`${name} is required`);
    });

    it("rejects malformed or unsupported database URLs safely", () => {
        expect(() => validateRuntimeEnvironment("worker", {
            ...baseEnvironment,
            DATABASE_URL: "not-a-database-url",
        })).toThrow("DATABASE_URL must be a valid PostgreSQL connection URL");
    });

    it("rejects invalid Redis configuration without echoing it", () => {
        const secretValue = "redis://user:private-password@/bad";
        expect(() => validateRuntimeEnvironment("worker", {
            ...baseEnvironment,
            REDIS_URL: secretValue,
        })).toThrow("REDIS_URL must be a valid Redis connection URL");
    });

    it("uses a local CORS origin by default and validates configured origins", () => {
        expect(getAllowedFrontendOrigins({})).toEqual(["http://localhost:5173"]);
        expect(getAllowedFrontendOrigins({
            FRONTEND_ORIGIN: "https://pulse.example,https://admin.example",
        })).toEqual(["https://pulse.example", "https://admin.example"]);
        expect(() => getAllowedFrontendOrigins({
            FRONTEND_ORIGIN: "https://pulse.example/path",
        })).toThrow("FRONTEND_ORIGIN must contain valid HTTP or HTTPS origins");
    });

    it("parses a configurable API port with a safe development default", () => {
        expect(parseApiPort(undefined)).toBe(3000);
        expect(parseApiPort("8080")).toBe(8080);
        expect(() => parseApiPort("70000")).toThrow("PORT must be an integer from 1 to 65535");
    });

    it("trusts no proxy by default and validates an explicit bounded hop count", () => {
        expect(parseTrustedProxyHops(undefined)).toBe(0);
        expect(parseTrustedProxyHops("1")).toBe(1);
        expect(() => parseTrustedProxyHops("11"))
            .toThrow("TRUST_PROXY_HOPS must be an integer from 0 to 10");
    });
});
