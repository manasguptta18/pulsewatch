import Joi from "joi";

export const createUserSchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(1)
        .max(100)
        .required(),

    email: Joi.string()
        .trim()
        .email()
        .required(),

    password: Joi.string()
        .min(8)
        .max(100)
        .custom((value, helpers) => Buffer.byteLength(value, "utf8") <= 72
            ? value
            : helpers.error("string.max", { limit: 72 }))
        .messages({ "string.max": "Password must be at most 72 UTF-8 bytes" })
        .required(),
});

export const loginSchema = Joi.object({
    email: Joi.string()
        .trim()
        .email()
        .required(),

    password: Joi.string()
        .min(8)
        .max(100)
        .required(),
});
