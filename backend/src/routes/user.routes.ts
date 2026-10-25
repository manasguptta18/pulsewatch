import { Router } from "express";

import { createUser } from "../services/user.service.js";
import { validate } from "../middleware/validate.middleware.js";
import { createUserSchema } from "../validation/user.schema.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.middleware.js";
import { consumeRateLimit } from "../lib/rate-limit.js";

const router = Router();

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
