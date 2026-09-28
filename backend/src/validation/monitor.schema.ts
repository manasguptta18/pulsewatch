import Joi from "joi";

export const createMonitorSchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(1)
        .max(500)
        .required(),
    
    url: Joi.string()
        .trim()
        .uri({
            scheme: ["http", "https"],
    })
    .required(),
});

export const updateMonitorSchema =
    Joi.object({
        name: Joi.string()
            .trim()
            .min(1)
            .max(100),

        url: Joi.string()
            .trim()
            .uri({
                scheme: ["http", "https"],
            }),

        method: Joi.string()
            .valid("GET", "POST", "PUT", "PATCH", "DELETE"),

        intervalSeconds: Joi.number()
            .integer()
            .min(10)
            .max(86400),

        timeoutSeconds: Joi.number()
            .integer()
            .min(1)
            .max(300),

        expectedStatus: Joi.number()
            .integer()
            .min(100)
            .max(599),

        isActive: Joi.boolean(),
    }).min(1);