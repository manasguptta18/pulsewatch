import { Router } from "express";

import { changeUserPassword, createUser } from "../services/user.service.js";
import { validate } from "../middleware/validate.middleware.js";
import { changePasswordSchema, createUserSchema } from "../validation/user.schema.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.middleware.js";
import { consumeRateLimit } from "../lib/rate-limit.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = Router();

router.post(
    "/me/password",
    authMiddleware,
    createRateLimitMiddleware({
        scope: "password-change",
        limit: 5,
        windowSeconds: 15 * 60,
        counter: { consume: consumeRateLimit },
    }),
    validate(changePasswordSchema),
    async (req, res, next) => {
        try {
            const result = await changeUserPassword(
                req.userId!,
                req.body.currentPassword,
                req.body.newPassword,
            );
            res.json(result);
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    "/",
    createRateLimitMiddleware({
        scope: "registration",
        limit: 5,
        windowSeconds: 60 * 60,
        counter: { consume: consumeRateLimit },
    }),
    validate(createUserSchema),
    async (req, res, next) => {
        try {
            const user = await createUser(req.body);

            res.status(201).json(user);
        } catch (error) {
            next(error);
        }
    }
);

export default router;
