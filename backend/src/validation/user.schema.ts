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