import type {Request,Response,NextFunction,} from "express";

import type { ObjectSchema } from "joi";

export function validate(schema: ObjectSchema){
    return (
        req: Request,
        res: Response,
        next: NextFunction
    ) =>{
        const {error, value} = schema.validate(
            req.body,
            {
                abortEarly: false,
                stripUnknown: true,
            }
        );

        if(error){
            return res.status(400).json({
                message: "Validation failed",
                errors: error.details.map(
                    (detail) => detail.message
                ),
            });
        }

        req.body = value;

        next();
    };
}