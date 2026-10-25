import Joi from "joi";
import { assertMonitorUrlSyntax } from "../services/safe-monitor-http.js";

const monitorUrl = Joi.string()
    .trim()
    .uri({ scheme: ["http", "https"] })
    .custom((value, helpers) => {
        try {
            assertMonitorUrlSyntax(value);
            return value;
        } catch {
            return helpers.error("string.uri");
        }
    });

export const createMonitorSchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(1)
        .max(100)
        .required(),
    
    url: monitorUrl.required(),
});

export const updateMonitorSchema =
    Joi.object({
        name: Joi.string()
            .trim()
            .min(1)
            .max(100),

        url: monitorUrl,

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
