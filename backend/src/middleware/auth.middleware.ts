import "dotenv/config";
import type {Request, Response, NextFunction} from "express";
import jwt from "jsonwebtoken";


export function authMiddleware(req: Request, res: Response, next: NextFunction){
    const jwtSecret = process.env.JWT_SECRET;

    if(!jwtSecret){
        return res.status(500).json({
            message: "Authentication is temporarily unavailable",
        });
    }

    const authHeader = req.headers.authorization;

    if(!authHeader){
        return res.status(401).json({
            message: "Authentication required",
        });
    }

    const parts = authHeader.split(" ");

    if(parts.length!==2 || parts[0]!== "Bearer" || !parts[1]){
        return res.status(401).json({
            message: "Invalid authorization format",
        });
    }

    const token = parts[1];

    try{
        const decoded = jwt.verify(token, jwtSecret, {
            algorithms: ["HS256"],
        });

        if (
            typeof decoded !== "object" ||
            decoded === null ||
            !Number.isSafeInteger(decoded.userId) ||
            decoded.userId <= 0
        ) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }

        req.userId = decoded.userId;

        next();
    }catch{
        return res.status(401).json({
            message: "Invalid or expired token",
        });
    }
}
