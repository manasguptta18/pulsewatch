import { Router } from "express";

import { createUser } from "../services/user.service.js";
import { validate } from "../middleware/validate.middleware.js";
import { createUserSchema } from "../validation/user.schema.js";

const router = Router();

router.post(
    "/",
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