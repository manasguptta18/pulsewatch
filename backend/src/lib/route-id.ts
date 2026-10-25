/** Parse canonical positive decimal IDs used in API route parameters. */
export function parsePositiveRouteId(value: unknown): number | null {
    if (typeof value !== "string") return null;
    if (!/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}
