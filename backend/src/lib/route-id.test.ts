import { describe, expect, it } from "vitest";
import { parsePositiveRouteId } from "./route-id.js";

describe("parsePositiveRouteId", () => {
    it("accepts positive decimal safe integers", () => {
        expect(parsePositiveRouteId("42")).toBe(42);
    });

    it.each(["", "0", "-1", "+1", "01", "1e2", "0x10", "9007199254740992"])(
        "rejects non-canonical or unsafe ID %s",
        (value) => expect(parsePositiveRouteId(value)).toBeNull(),
    );
});
