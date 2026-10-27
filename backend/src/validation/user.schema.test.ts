import { describe, expect, it } from "vitest";
import { changePasswordSchema, createUserSchema, loginSchema } from "./user.schema.js";

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

    it("requires matching confirmation and enforces the bcrypt byte limit on new passwords", () => {
        expect(changePasswordSchema.validate({
            currentPassword: "old-password",
            newPassword: "new-password",
            confirmPassword: "different",
        }).error).toBeDefined();
        expect(changePasswordSchema.validate({
            currentPassword: "old-password",
            newPassword: "😀".repeat(19),
            confirmPassword: "😀".repeat(19),
        }).error).toBeDefined();
        expect(changePasswordSchema.validate({
            currentPassword: "old-password",
            newPassword: "new-password",
            confirmPassword: "new-password",
        }).error).toBeUndefined();
    });
});
