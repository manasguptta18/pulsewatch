import {Router} from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { investigationfunction } from "../services/investigation.service";
import { generateIncidentSummary } from "../services/ai.services.js";
import { parsePositiveRouteId } from "../lib/route-id.js";

const router = Router();


router.get("/:id/ai-summary", authMiddleware,async (req,res,next)=>{
    try{
        const incidentId = parsePositiveRouteId(req.params.id);

        if(incidentId === null){
            return res.status(400).json({
                message: "Invalid incident ID",
            });
        }

        const investigation = await investigationfunction(
            incidentId,
            req.userId!,
        );

        const aiSummary = await generateIncidentSummary(investigation);

        res.json({
            investigation,
            aiSummary,
        });
    }catch(error){
        next(error);
    }
})

export default router;
