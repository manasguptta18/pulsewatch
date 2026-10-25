import { Router } from "express";

import {
    validate,
} from "../middleware/validate.middleware.js";

import {
    createMonitorSchema,
    updateMonitorSchema,
} from "../validation/monitor.schema.js";

import {
    createMonitor,
    checkMonitorForUser,
    getUserMonitors,
    getMonitorByIdForUser,
    updateMonitorForUser,
    deleteMonitorForUser,
} from "../services/monitor.service.js";

import { authMiddleware } from "../middleware/auth.middleware.js";
import { parsePositiveRouteId } from "../lib/route-id.js";

const router = Router();

router.post(
    "/",
    authMiddleware,
    validate(createMonitorSchema),
    async (req, res, next) => {
        try {
            const monitor = await createMonitor({
                userId: req.userId!,
                name: req.body.name,
                url: req.body.url,
            });

            res.status(201).json(monitor);
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    "/",
    authMiddleware,
    async (req, res, next) => {
        try {
            const wantsPagination = req.query.limit !== undefined || req.query.after !== undefined;
            let pagination: { limit: number; afterId?: number } | undefined;
            if (wantsPagination) {
                const limitValue = req.query.limit;
                const afterValue = req.query.after;
                const parsedLimit = limitValue === undefined
                    ? 50
                    : typeof limitValue === "string" && /^[1-9]\d*$/.test(limitValue)
                        ? Number(limitValue)
                        : null;
                const afterId = afterValue === undefined
                    ? undefined
                    : parsePositiveRouteId(afterValue);
                if (
                    parsedLimit === null ||
                    !Number.isSafeInteger(parsedLimit) ||
                    parsedLimit < 1 ||
                    parsedLimit > 100 ||
                    (afterValue !== undefined && afterId === null)
                ) {
                    return res.status(400).json({ message: "Invalid monitor pagination" });
                }
                pagination = {
                    limit: parsedLimit,
                    ...(typeof afterId === "number" ? { afterId } : {}),
                };
            }

            const monitors = await getUserMonitors(req.userId!, pagination);

            if (pagination) {
                const hasMore = monitors.length > pagination.limit;
                const page = hasMore ? monitors.slice(0, pagination.limit) : monitors;
                res.setHeader("X-Has-More", String(hasMore));
                if (hasMore) {
                    res.setHeader("X-Next-Cursor", String(page[page.length - 1]!.id));
                }
                return res.json(page);
            }

            res.json(monitors);
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    "/:id",
    authMiddleware,
    async (req, res, next) => {
        try {
            const monitorId = parsePositiveRouteId(req.params.id);

            if (monitorId === null) {
                return res.status(400).json({
                    message: "Invalid monitor ID",
                });
            }

            const monitor =
                await getMonitorByIdForUser(
                    monitorId,
                    req.userId!
                );

            res.json(monitor);
        } catch (error) {
            next(error);
        }
    }
);

router.post(
    "/:id/check",
    authMiddleware,
    async (req, res, next) => {
        try {
            const monitorId = parsePositiveRouteId(req.params.id);

            if (monitorId === null) {
                return res.status(400).json({
                    message: "Invalid monitor ID",
                });
            }

            const check =
                await checkMonitorForUser(
                    monitorId,
                    req.userId!
                );

            res.status(201).json(check);
        } catch (error) {
            next(error);
        }
    }
);

router.patch(
    "/:id",
    authMiddleware,
    validate(updateMonitorSchema),
    async (req, res, next) => {
        try {
            const monitorId = parsePositiveRouteId(req.params.id);

            if (monitorId === null) {
                return res.status(400).json({
                    message: "Invalid monitor ID",
                });
            }

            const monitor =
                await updateMonitorForUser(
                    monitorId,
                    req.userId!,
                    req.body
                );

            res.json(monitor);
        } catch (error) {
            next(error);
        }
    }
);

router.delete(
    "/:id",
    authMiddleware,
    async (req, res, next) => {
        try {
            const monitorId = parsePositiveRouteId(req.params.id);

            if (monitorId === null) {
                return res.status(400).json({
                    message: "Invalid monitor ID",
                });
            }

            const result =
                await deleteMonitorForUser(
                    monitorId,
                    req.userId!
                );

            res.json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;
