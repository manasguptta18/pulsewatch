/**
 * Return only standardized error metadata suitable for logs.
 * Messages and stacks are intentionally excluded because adapters may include
 * connection strings, request data, or credentials in them.
 */
export function safeErrorDetails(error: unknown): {
    errorName: string;
    errorCodes?: string[];
} {
    let current: unknown = error;
    let errorName = "UnknownError";
    const errorCodes: string[] = [];
    const seen = new Set<object>();

    for (let depth = 0; depth < 4; depth += 1) {
        if (typeof current !== "object" || current === null || seen.has(current)) break;
        seen.add(current);

        const candidate = current as { name?: unknown; code?: unknown; cause?: unknown };
        if (depth === 0 && typeof candidate.name === "string" && /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(candidate.name)) {
            errorName = candidate.name;
        }

        if (
            typeof candidate.code === "string" &&
            /^(?:[A-Z][A-Z0-9_]{1,31}|[0-9A-Z]{5})$/.test(candidate.code) &&
            !errorCodes.includes(candidate.code)
        ) {
            errorCodes.push(candidate.code);
        }

        current = candidate.cause;
    }

    return errorCodes.length > 0 ? { errorName, errorCodes } : { errorName };
}
