import { describe, expect, it } from "vitest";
import { safeErrorDetails } from "./safe-error.js";

describe("safe error log details", () => {
    it("keeps standardized names and codes across nested causes", () => {
        const cause = Object.assign(new Error("database host details"), { code: "42P01" });
        const error = Object.assign(new Error("postgres://user:secret@localhost/db"), {
            code: "P2021",
            cause,
        });

        expect(safeErrorDetails(error)).toEqual({
            errorName: "Error",
            errorCodes: ["P2021", "42P01"],
        });
        expect(JSON.stringify(safeErrorDetails(error))).not.toContain("secret");
        expect(JSON.stringify(safeErrorDetails(error))).not.toContain("localhost");
    });

    it("omits arbitrary messages, stacks, and non-standard codes", () => {
        const error = Object.assign(new Error("JWT secret and connection details"), {
            code: "password-is-secret",
        });

        expect(safeErrorDetails(error)).toEqual({ errorName: "Error" });
    });

    it("handles non-Error values without logging their contents", () => {
        expect(safeErrorDetails("postgres://user:secret@localhost/db")).toEqual({
            errorName: "UnknownError",
        });
    });
});
