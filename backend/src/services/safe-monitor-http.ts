import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";
import * as http from "node:http";
import * as https from "node:https";

const MAX_REDIRECTS = 5;
const CONNECTION_TIMEOUT_MS = 5_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const blockedIpv4 = new BlockList();
for (const [subnet, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const) {
    blockedIpv4.addSubnet(subnet, prefix, "ipv4");
}

const globalUnicastIpv6 = new BlockList();
globalUnicastIpv6.addSubnet("2000::", 3, "ipv6");

const blockedIpv6 = new BlockList();
for (const [subnet, prefix] of [
    ["2001::", 23], // IETF special-purpose assignments
    ["2001:db8::", 32], // Documentation
    ["2002::", 16], // 6to4 can embed a restricted IPv4 destination
    ["3fff::", 20], // Documentation
] as const) {
    blockedIpv6.addSubnet(subnet, prefix, "ipv6");
}

export class MonitorUrlPolicyError extends Error {
    constructor() {
        super("Monitor URL is not allowed");
        this.name = "MonitorUrlPolicyError";
    }
}

export class MonitorRequestError extends Error {
    constructor() {
        super("Monitor check failed");
        this.name = "MonitorRequestError";
    }
}

type ResolvedAddress = {
    address: string;
    family: 4 | 6;
};

type MonitorResponse = {
    statusCode: number;
    headers: IncomingHttpHeaders;
};

type PinnedRequest = (
    url: URL,
    method: string,
    address: ResolvedAddress,
    connectTimeoutMs: number,
    signal: AbortSignal,
) => Promise<MonitorResponse>;

type RequestFactory = (
    protocol: "http:" | "https:",
    url: URL,
    options: Record<string, unknown>,
    onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

type SafeMonitorHttpDependencies = {
    resolveHost: (hostname: string) => Promise<ResolvedAddress[]>;
    requestPinned?: PinnedRequest;
    requestFactory?: RequestFactory;
    connectionTimeoutMs?: number;
};

export type SafeMonitorHttpTestDependencies = SafeMonitorHttpDependencies;

const nodeRequestFactory: RequestFactory = (protocol, url, options, onResponse) =>
    protocol === "https:"
        ? https.request(url, options as https.RequestOptions, onResponse)
        : http.request(url, options as http.RequestOptions, onResponse);

const defaultDependencies: SafeMonitorHttpDependencies = {
    resolveHost: async (hostname) => {
        const records = await dnsLookup(hostname, { all: true, verbatim: true });
        return records
            .filter((record) => record.family === 4 || record.family === 6)
            .map((record) => ({
                address: record.address,
                family: record.family as 4 | 6,
            }));
    },
    requestFactory: nodeRequestFactory,
};

function parseHttpUrl(input: string): URL {
    try {
        const url = new URL(input);
        const authority = url.href.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? "";
        if (
            (url.protocol !== "http:" && url.protocol !== "https:") ||
            !url.hostname ||
            url.username.length > 0 ||
            url.password.length > 0 ||
            authority.includes("@")
        ) {
            throw new MonitorUrlPolicyError();
        }
        return url;
    } catch {
        throw new MonitorUrlPolicyError();
    }
}

function ipv6Bytes(address: string): number[] | null {
    let value = address.toLowerCase();
    const dottedTail = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dottedTail) {
        const dottedAddress = dottedTail[1];
        if (!dottedAddress) return null;
        const octets = dottedAddress.split(".").map(Number);
        if (octets.some((octet) => octet < 0 || octet > 255)) return null;
        const [first, second, third, fourth] = octets;
        if (first === undefined || second === undefined || third === undefined || fourth === undefined) return null;
        value = value.slice(0, -dottedAddress.length) +
            ((first << 8) | second).toString(16) + ":" +
            ((third << 8) | fourth).toString(16);
    }

    const halves = value.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missingWords = 8 - left.length - right.length;
    if ((halves.length === 1 && missingWords !== 0) || (halves.length === 2 && missingWords < 1)) return null;
    const words = [...left, ...Array(missingWords).fill("0"), ...right];
    if (words.length !== 8 || words.some((word) => !/^[\da-f]{1,4}$/.test(word))) return null;
    return words.flatMap((word) => {
        const parsed = Number.parseInt(word, 16);
        return [parsed >> 8, parsed & 0xff];
    });
}

function normalizeAddress(address: ResolvedAddress): ResolvedAddress {
    const family = isIP(address.address);
    if (family === 4) return { address: address.address, family: 4 };
    if (family !== 6) throw new MonitorUrlPolicyError();

    const bytes = ipv6Bytes(address.address);
    if (!bytes) throw new MonitorUrlPolicyError();
    const isIpv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0) &&
        bytes[10] === 0xff && bytes[11] === 0xff;
    if (isIpv4Mapped) {
        const mappedAddress = bytes.slice(12);
        if (mappedAddress.length !== 4) throw new MonitorUrlPolicyError();
        return {
            address: mappedAddress.join("."),
            family: 4,
        };
    }
    return { address: address.address, family: 6 };
}

export function isPublicAddress(address: ResolvedAddress): boolean {
    try {
        const normalized = normalizeAddress(address);
        if (normalized.family === 4) {
            return !blockedIpv4.check(normalized.address, "ipv4");
        }

        return globalUnicastIpv6.check(normalized.address, "ipv6") &&
            !blockedIpv6.check(normalized.address, "ipv6");
    } catch {
        return false;
    }
}

async function resolveAndValidate(
    url: URL,
    resolveHost: SafeMonitorHttpDependencies["resolveHost"],
): Promise<ResolvedAddress> {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
    if (
        normalizedHostname === "localhost" ||
        normalizedHostname.endsWith(".localhost") ||
        normalizedHostname.endsWith(".local") ||
        normalizedHostname.endsWith(".internal")
    ) {
        throw new MonitorUrlPolicyError();
    }
    const literalFamily = isIP(hostname);
    let addresses: ResolvedAddress[];

    try {
        addresses = literalFamily
            ? [{ address: hostname, family: literalFamily as 4 | 6 }]
            : await resolveHost(hostname);
    } catch {
        throw new MonitorUrlPolicyError();
    }

    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
        throw new MonitorUrlPolicyError();
    }

    // All DNS answers have been checked. Pin this request to one of those checked answers.
    const firstAddress = addresses[0];
    if (!firstAddress) throw new MonitorUrlPolicyError();
    return normalizeAddress(firstAddress);
}

export async function validateMonitorUrl(
    input: string,
    dependencies: Pick<SafeMonitorHttpDependencies, "resolveHost"> = defaultDependencies,
): Promise<void> {
    const url = parseHttpUrl(input);
    await resolveAndValidate(url, dependencies.resolveHost);
}

export function assertMonitorUrlSyntax(input: string): void {
    parseHttpUrl(input);
}

export function createPinnedLookup(address: ResolvedAddress) {
    return (
        _hostname: string,
        options: LookupOptions,
        callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
    ) => {
        if (options.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
    };
}

export async function requestPublicMonitor(
    input: string,
    method: string,
    timeoutMs: number,
    dependencies: SafeMonitorHttpDependencies = defaultDependencies,
): Promise<{ statusCode: number }> {
    const controller = new AbortController();
    const totalTimeout = setTimeout(() => controller.abort(), timeoutMs);
    let currentUrl = parseHttpUrl(input);
    let requestMethod = method;
    let redirectCount = 0;

    try {
        while (true) {
            if (controller.signal.aborted) throw new MonitorRequestError();

            let address: ResolvedAddress;
            try {
                address = await Promise.race([
                    resolveAndValidate(currentUrl, dependencies.resolveHost),
                    new Promise<never>((_, reject) => {
                        controller.signal.addEventListener(
                            "abort",
                            () => reject(new MonitorRequestError()),
                            { once: true },
                        );
                    }),
                ]);
            } catch {
                throw new MonitorRequestError();
            }

            let response: MonitorResponse;
            try {
                const requestPinnedWithConfiguredTransport = dependencies.requestPinned ??
                    ((requestUrl, requestMethodForHop, pinnedAddress, connectTimeoutMs, signal) =>
                        requestPinned(
                            requestUrl,
                            requestMethodForHop,
                            pinnedAddress,
                            connectTimeoutMs,
                            signal,
                            dependencies.requestFactory ?? nodeRequestFactory,
                        ));
                response = await requestPinnedWithConfiguredTransport(
                    currentUrl,
                    requestMethod,
                    address,
                    Math.min(dependencies.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS, timeoutMs),
                    controller.signal,
                );
            } catch {
                throw new MonitorRequestError();
            }

            const location = response.headers.location;
            if (!REDIRECT_STATUSES.has(response.statusCode) || typeof location !== "string") {
                return { statusCode: response.statusCode };
            }
            if (redirectCount >= MAX_REDIRECTS) throw new MonitorRequestError();

            try {
                currentUrl = parseHttpUrl(new URL(location, currentUrl).toString());
            } catch {
                throw new MonitorRequestError();
            }

            if (
                [301, 302, 303].includes(response.statusCode) &&
                requestMethod !== "GET" &&
                requestMethod !== "HEAD"
            ) {
                requestMethod = "GET";
            }
            redirectCount += 1;
        }
    } finally {
        clearTimeout(totalTimeout);
    }
}

function requestPinned(
    url: URL,
    method: string,
    address: ResolvedAddress,
    connectTimeoutMs: number,
    signal: AbortSignal,
    requestFactory: RequestFactory,
): Promise<MonitorResponse> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let connectTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = (error?: Error, response?: MonitorResponse) => {
            if (settled) return;
            settled = true;
            if (connectTimer) clearTimeout(connectTimer);
            signal.removeEventListener("abort", onAbort);
            if (error) reject(error);
            else if (response) resolve(response);
            else reject(new Error("Request failed"));
        };

        const onAbort = () => request.destroy(new Error("Request aborted"));
        const request = requestFactory(
            url.protocol as "http:" | "https:",
            url,
            {
                method,
                agent: false,
                lookup: createPinnedLookup(address),
                ...(url.protocol === "https:" && isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0
                    ? { servername: url.hostname }
                    : {}),
                rejectUnauthorized: true,
            },
            (response) => {
                const statusCode = response.statusCode ?? 0;
                const headers = response.headers;
                response.destroy();
                finish(undefined, { statusCode, headers });
            },
        );

        request.once("error", (error) => finish(error));
        request.once("socket", (socket) => {
            connectTimer = setTimeout(
                () => request.destroy(new Error("Connection timed out")),
                connectTimeoutMs,
            );
            const connectedEvent = url.protocol === "https:" ? "secureConnect" : "connect";
            socket.once(connectedEvent, () => {
                if (connectTimer) clearTimeout(connectTimer);
                connectTimer = undefined;
            });
        });

        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
        request.end();
    });
}
