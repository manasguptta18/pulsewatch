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
            const monitors =
                await getUserMonitors(
                    req.userId!
                );

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
            const monitorId = Number(
                req.params.id
            );

            if (!Number.isInteger(monitorId)) {
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
            const monitorId = Number(
                req.params.id
            );

            if (!Number.isInteger(monitorId)) {
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
            const monitorId = Number(
                req.params.id
            );

            if (!Number.isInteger(monitorId)) {
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
            const monitorId = Number(
                req.params.id
            );

            if (!Number.isInteger(monitorId)) {
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