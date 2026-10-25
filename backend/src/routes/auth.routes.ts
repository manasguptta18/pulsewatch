import { Router } from "express";
import { loginUser } from "../services/auth.service.js";
import { validate } from "../middleware/validate.middleware.js";
import { loginSchema } from "../validation/user.schema.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.middleware.js";
import { consumeRateLimit } from "../lib/rate-limit.js";

const router = Router();

router.post(
    "/login",
    createRateLimitMiddleware({
        scope: "login",
        limit: 10,
        windowSeconds: 60,
        counter: { consume: consumeRateLimit },
    }),
    validate(loginSchema),
    async (req, res, next) => {
        try {
            const result = await loginUser(req.body);

            res.json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;
