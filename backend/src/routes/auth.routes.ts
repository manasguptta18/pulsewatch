import { Router } from "express";
import { loginUser } from "../services/auth.service.js";
import { validate } from "../middleware/validate.middleware.js";
import { loginSchema } from "../validation/user.schema.js";

const router = Router();

router.post(
    "/login",
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