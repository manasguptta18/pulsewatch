import { describe, expect, it } from "vitest";
import { createUserSchema, loginSchema } from "./user.schema.js";

describe("user request schemas", () => {
    it("rejects registration passwords exceeding bcrypt's 72-byte input", () => {
        const result = createUserSchema.validate({
            name: "A User",
            email: "user@example.com",
            password: "a".repeat(73),
        });
        expect(result.error?.details[0]?.message)
            .toBe("Password must be at most 72 UTF-8 bytes");
    });

    it("applies the bcrypt byte limit to Unicode passwords", () => {
        const result = createUserSchema.validate({
            name: "A User",
            email: "user@example.com",
            password: "😀".repeat(19),
        });
        expect(result.error).toBeDefined();
    });

    it("keeps the login password schema compatible with existing accounts", () => {
        expect(loginSchema.validate({
            email: "user@example.com",
            password: "a".repeat(73),
        }).error).toBeUndefined();
    });
});
