import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
    assertMonitorUrlSyntax,
    createPinnedLookup,
    isPublicAddress,
    MonitorRequestError,
    MonitorUrlPolicyError,
    requestPublicMonitor,
    validateMonitorUrl,
    type SafeMonitorHttpTestDependencies,
} from "./safe-monitor-http.js";

const publicV4 = { address: "93.184.216.34", family: 4 as const };
const publicV6 = { address: "2001:4860:4860::8888", family: 6 as const };

function dependencies(
    resolveHost: SafeMonitorHttpTestDependencies["resolveHost"],
    requestPinned: SafeMonitorHttpTestDependencies["requestPinned"],
): SafeMonitorHttpTestDependencies {
    return {
        resolveHost,
        ...(requestPinned === undefined ? {} : { requestPinned }),
    };
}

type CapturedTransportOptions = {
    agent?: boolean;
    lookup?: (
        hostname: string,
        options: { all?: boolean },
        callback: (error: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void,
    ) => void;
    rejectUnauthorized?: boolean;
    servername?: string;
};

type TransportCall = {
    protocol: "http:" | "https:";
    url: URL;
    options: CapturedTransportOptions;
    lookupAddress?: string | { address: string; family: number }[];
    lookupFamily?: number;
};

function transportFixture(
    respond: (call: TransportCall, requestNumber: number) => { statusCode: number; headers: Record<string, string> } | undefined,
    options: { connect?: boolean; beforeLookup?: (call: TransportCall) => void } = {},
) {
    const calls: TransportCall[] = [];
    const requestFactory: NonNullable<SafeMonitorHttpTestDependencies["requestFactory"]> = (
        protocol,
        url,
        rawOptions,
        onResponse,
    ) => {
        const call: TransportCall = {
            protocol,
            url,
            options: rawOptions as CapturedTransportOptions,
        };
        calls.push(call);

        const request = new EventEmitter() as EventEmitter & {
            destroy: (error?: Error) => EventEmitter;
            end: () => void;
        };
        let destroyed = false;
        request.destroy = (error?: Error) => {
            if (!destroyed && error) {
                destroyed = true;
                queueMicrotask(() => request.emit("error", error));
            }
            return request;
        };
        request.end = () => {
            queueMicrotask(() => {
                const socket = new EventEmitter();
                request.emit("socket", socket);
                if (options.connect !== false) {
                    socket.emit(protocol === "https:" ? "secureConnect" : "connect");
                }

                options.beforeLookup?.(call);
                const lookup = call.options.lookup;
                if (!lookup) throw new Error("Transport did not receive the pinned lookup");
                lookup(url.hostname, {}, (error, address, family) => {
                    if (error) throw error;
                    call.lookupAddress = address;
                    if (family !== undefined) call.lookupFamily = family;
                });

                const response = respond(call, calls.length);
                if (response) {
                    onResponse({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        destroy: () => undefined,
                    } as unknown as import("node:http").IncomingMessage);
                }
            });
        };
        return request as unknown as import("node:http").ClientRequest;
    };

    return { calls, requestFactory };
}

function transportDependencies(
    resolveHost: SafeMonitorHttpTestDependencies["resolveHost"],
    requestFactory: NonNullable<SafeMonitorHttpTestDependencies["requestFactory"]>,
    connectionTimeoutMs?: number,
): SafeMonitorHttpTestDependencies {
    return {
        resolveHost,
        requestFactory,
        ...(connectionTimeoutMs === undefined ? {} : { connectionTimeoutMs }),
    };
}

describe("monitor URL policy", () => {
    it.each([
        "http://93.184.216.34/health",
        "https://[2001:4860:4860::8888]/health",
    ])("accepts public HTTP/HTTPS URL %s", async (url) => {
        await expect(validateMonitorUrl(url, {
            resolveHost: async () => [publicV4],
        })).resolves.toBeUndefined();
    });

    it.each([
        "http://localhost/",
        "http://127.0.0.1/",
        "http://10.1.2.3/",
        "http://172.16.0.1/",
        "http://192.168.1.1/",
        "http://169.254.169.254/",
        "http://[::1]/",
        "http://[fc00::1]/",
        "http://[fe80::1]/",
        "http://[ff02::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:7f00:1]/",
        "http://[2001:db8::1]/",
        "http://[3fff::1]/",
    ])("rejects restricted literal or localhost destination %s", async (url) => {
        await expect(validateMonitorUrl(url, {
            resolveHost: async () => [publicV4],
        })).rejects.toBeInstanceOf(MonitorUrlPolicyError);
    });

    it("rejects credentials, unsupported protocols, and malformed URLs", () => {
        for (const url of [
            "ftp://example.com/file",
            "file:///etc/passwd",
            "http://user:password@example.com/",
            "https://example.com:99999/",
            "not a URL",
        ]) {
            expect(() => assertMonitorUrlSyntax(url)).toThrow(MonitorUrlPolicyError);
        }
    });

    it("bounds DNS validation for create and update requests", async () => {
        await expect(validateMonitorUrl("https://slow.example/", {
            resolveHost: () => new Promise(() => undefined),
            validationTimeoutMs: 5,
        })).rejects.toBeInstanceOf(MonitorUrlPolicyError);
    });

    it("rejects private, loopback, mapped, multicast, reserved, and link-local addresses", () => {
        const addresses = [
            ["0.1.2.3", 4], ["10.0.0.1", 4], ["100.64.0.1", 4],
            ["127.0.0.1", 4], ["169.254.1.1", 4], ["172.20.1.2", 4],
            ["192.0.2.1", 4], ["192.168.1.1", 4], ["198.18.0.1", 4],
            ["198.51.100.1", 4], ["203.0.113.1", 4], ["224.0.0.1", 4],
            ["240.0.0.1", 4], ["::", 6], ["::1", 6], ["fc00::1", 6],
            ["fe80::1", 6], ["ff02::1", 6], ["::ffff:127.0.0.1", 6],
            ["::ffff:7f00:1", 6], ["2001:db8::1", 6], ["2002:7f00:1::", 6],
        ] as const;
        for (const [address, family] of addresses) {
            expect(isPublicAddress({ address, family })).toBe(false);
        }
        expect(isPublicAddress(publicV4)).toBe(true);
        expect(isPublicAddress(publicV6)).toBe(true);
    });

    it("rejects a DNS answer containing a restricted address", async () => {
        await expect(validateMonitorUrl("https://mixed.example", {
            resolveHost: async () => [publicV4, { address: "10.0.0.8", family: 4 }],
        })).rejects.toBeInstanceOf(MonitorUrlPolicyError);
    });

    it("rejects mixed public and restricted DNS answers before making a request", async () => {
        const requestPinned = vi.fn();
        await expect(requestPublicMonitor(
            "https://mixed.example/health",
            "GET",
            1_000,
            dependencies(
                async () => [publicV4, { address: "192.168.1.20", family: 4 }],
                requestPinned,
            ),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(requestPinned).not.toHaveBeenCalled();
    });
});

describe("pinned monitor requests and redirects", () => {
    it("pins the socket lookup to the already validated DNS address", () => {
        const lookup = createPinnedLookup(publicV4);
        const callback = vi.fn();
        // Simulate DNS changing after validation; this lookup never resolves again.
        const currentDnsAnswer = { address: "127.0.0.1", family: 4 };
        expect(currentDnsAnswer.address).not.toBe(publicV4.address);
        lookup("example.com", {}, callback);
        expect(callback).toHaveBeenCalledWith(null, publicV4.address, publicV4.family);
    });

    it("validates and follows public redirects explicitly", async () => {
        const requests: string[] = [];
        const resolveHost = vi.fn(async () => [publicV4]);
        const requestPinned = vi.fn(async (url: URL) => {
            requests.push(url.href);
            return requests.length === 1
                ? { statusCode: 302, headers: { location: "https://next.example/health" } }
                : { statusCode: 204, headers: {} };
        });

        const result = await requestPublicMonitor(
            "https://start.example/health",
            "GET",
            1_000,
            dependencies(resolveHost, requestPinned),
        );
        expect(result.statusCode).toBe(204);
        expect(requests).toEqual([
            "https://start.example/health",
            "https://next.example/health",
        ]);
        expect(resolveHost).toHaveBeenCalledTimes(2);
    });

    it("blocks a redirect to a private address without contacting it", async () => {
        const requestPinned = vi.fn(async () => ({
            statusCode: 302,
            headers: { location: "http://127.0.0.1/admin" },
        }));
        await expect(requestPublicMonitor(
            "https://public.example/",
            "GET",
            1_000,
            dependencies(async () => [publicV4], requestPinned),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(requestPinned).toHaveBeenCalledTimes(1);
    });

    it("blocks a redirect hostname with a restricted DNS answer", async () => {
        const requestPinned = vi.fn(async () => ({
            statusCode: 302,
            headers: { location: "https://private.example/admin" },
        }));
        await expect(requestPublicMonitor(
            "https://public.example/",
            "GET",
            1_000,
            dependencies(
                async (hostname) => hostname === "private.example"
                    ? [{ address: "10.20.0.5", family: 4 }]
                    : [publicV4],
                requestPinned,
            ),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(requestPinned).toHaveBeenCalledTimes(1);
    });

    it("rejects credentials or unsupported protocols in redirect locations", async () => {
        const requestPinned = vi.fn(async () => ({
            statusCode: 301,
            headers: { location: "https://user:pass@next.example/" },
        }));
        await expect(requestPublicMonitor(
            "https://public.example/",
            "GET",
            1_000,
            dependencies(async () => [publicV4], requestPinned),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(requestPinned).toHaveBeenCalledTimes(1);
    });

    it("stops after the configured redirect limit", async () => {
        let redirectNumber = 0;
        const requestPinned = vi.fn(async () => ({
            statusCode: 302,
            headers: { location: `https://public.example/${++redirectNumber}` },
        }));
        await expect(requestPublicMonitor(
            "https://public.example/0",
            "GET",
            1_000,
            dependencies(async () => [publicV4], requestPinned),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(requestPinned).toHaveBeenCalledTimes(6);
    });

    it("applies a total timeout and reports a generic failure", async () => {
        const requestPinned = vi.fn((_url, _method, _address, _connectTimeout, signal) =>
            new Promise<never>((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("secret network detail")));
            }),
        );
        await expect(requestPublicMonitor(
            "https://public.example/",
            "GET",
            5,
            dependencies(async () => [publicV4], requestPinned),
        )).rejects.toEqual(new MonitorRequestError());
        expect(requestPinned.mock.calls[0]?.[3]).toBe(5);
    });

    it("sets a separate bounded connection timeout", async () => {
        const requestPinned = vi.fn(async (
            _url: URL,
            _method: string,
            _address: { address: string; family: 4 | 6 },
            _connectTimeoutMs: number,
        ) => ({ statusCode: 200, headers: {} }));
        await requestPublicMonitor(
            "https://public.example/",
            "GET",
            30_000,
            dependencies(async () => [publicV4], requestPinned),
        );
        expect(requestPinned.mock.calls[0]?.[3]).toBe(5_000);
    });

    it("pins every redirect hop to a public address returned by that hop's DNS lookup", async () => {
        const resolved: string[] = [];
        const pinned: string[] = [];
        const resolveHost = async (hostname: string) => {
            resolved.push(hostname);
            return [hostname === "second.example" ? publicV6 : publicV4];
        };
        const requestPinned = async (_url: URL, _method: string, address: { address: string }) => {
            pinned.push(address.address);
            return pinned.length === 1
                ? { statusCode: 307, headers: { location: "https://second.example/" } }
                : { statusCode: 200, headers: {} };
        };
        await requestPublicMonitor(
            "https://first.example/",
            "GET",
            1_000,
            dependencies(resolveHost, requestPinned),
        );
        expect(resolved).toEqual(["first.example", "second.example"]);
        expect(pinned).toEqual([publicV4.address, publicV6.address]);
    });
});

describe("production Node transport boundary", () => {
    it("passes a validated, pinned lookup into the HTTP transport without a second DNS resolution", async () => {
        let currentDnsAddress = publicV4.address;
        const resolver = vi.fn(async () => [{ ...publicV4 }]);
        const fixture = transportFixture(
            () => ({ statusCode: 200, headers: {} }),
            {
                beforeLookup: () => {
                    currentDnsAddress = "127.0.0.1";
                },
            },
        );

        await requestPublicMonitor(
            "http://pin.example/health",
            "GET",
            1_000,
            transportDependencies(resolver, fixture.requestFactory),
        );

        expect(currentDnsAddress).toBe("127.0.0.1");
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(fixture.calls).toHaveLength(1);
        expect(fixture.calls[0]?.protocol).toBe("http:");
        expect(fixture.calls[0]?.lookupAddress).toBe(publicV4.address);
        expect(fixture.calls[0]?.lookupFamily).toBe(publicV4.family);
    });

    it("passes HTTPS certificate verification and the original hostname to TLS", async () => {
        const fixture = transportFixture(() => ({ statusCode: 204, headers: {} }));
        await requestPublicMonitor(
            "https://tls.example/health",
            "GET",
            1_000,
            transportDependencies(async () => [publicV4], fixture.requestFactory),
        );

        const call = fixture.calls[0];
        expect(call?.protocol).toBe("https:");
        expect(call?.options.rejectUnauthorized).toBe(true);
        expect(call?.options.servername).toBe("tls.example");
        expect(call?.options.agent).toBe(false);
        expect(call?.lookupAddress).toBe(publicV4.address);
    });

    it("does not invoke the transport when DNS fails or returns a restricted answer", async () => {
        const failedDnsFixture = transportFixture(() => ({ statusCode: 200, headers: {} }));
        await expect(requestPublicMonitor(
            "https://missing.example/",
            "GET",
            1_000,
            transportDependencies(async () => { throw new Error("resolver detail"); }, failedDnsFixture.requestFactory),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(failedDnsFixture.calls).toHaveLength(0);

        const restrictedDnsFixture = transportFixture(() => ({ statusCode: 200, headers: {} }));
        await expect(requestPublicMonitor(
            "https://restricted.example/",
            "GET",
            1_000,
            transportDependencies(async () => [publicV4, { address: "10.0.0.9", family: 4 }], restrictedDnsFixture.requestFactory),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(restrictedDnsFixture.calls).toHaveLength(0);
    });

    it("revalidates a relative redirect before the next HTTP transport call", async () => {
        const resolver = vi.fn(async () => [publicV4]);
        const fixture = transportFixture((_call, requestNumber) => requestNumber === 1
            ? { statusCode: 302, headers: { location: "/next" } }
            : { statusCode: 200, headers: {} });

        await requestPublicMonitor(
            "http://redirect.example/start",
            "GET",
            1_000,
            transportDependencies(resolver, fixture.requestFactory),
        );

        expect(fixture.calls.map((call) => call.url.href)).toEqual([
            "http://redirect.example/start",
            "http://redirect.example/next",
        ]);
        expect(resolver).toHaveBeenCalledTimes(2);
    });

    it("does not invoke the transport for a redirect to a restricted destination", async () => {
        const resolver = vi.fn(async (hostname: string) => hostname === "origin.example"
            ? [publicV4]
            : [{ address: "127.0.0.1", family: 4 as const }]);
        const fixture = transportFixture(() => ({
            statusCode: 302,
            headers: { location: "http://redirected.example/admin" },
        }));

        await expect(requestPublicMonitor(
            "https://origin.example/",
            "GET",
            1_000,
            transportDependencies(resolver, fixture.requestFactory),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(fixture.calls).toHaveLength(1);
        expect(resolver).toHaveBeenCalledTimes(2);
    });

    it("enforces connection and total timeouts through the production request wrapper", async () => {
        const connectionFixture = transportFixture(
            () => undefined,
            { connect: false },
        );
        await expect(requestPublicMonitor(
            "https://connection-timeout.example/",
            "GET",
            1_000,
            transportDependencies(async () => [publicV4], connectionFixture.requestFactory, 15),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(connectionFixture.calls).toHaveLength(1);

        const totalFixture = transportFixture(
            () => undefined,
            { connect: false },
        );
        await expect(requestPublicMonitor(
            "https://total-timeout.example/",
            "GET",
            20,
            transportDependencies(async () => [publicV4], totalFixture.requestFactory, 500),
        )).rejects.toBeInstanceOf(MonitorRequestError);
        expect(totalFixture.calls).toHaveLength(1);
    });
});
