import {Router} from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { investigationfunction } from "../services/investigation.service";
import { generateIncidentSummary } from "../services/ai.services.js";

const router = Router();


router.get("/:id/ai-summary", authMiddleware,async (req,res,next)=>{
    try{
        const incidentId = Number(req.params.id);

        if(!Number.isInteger(incidentId)){
            return res.status(400).json({
                message: "Invalid incident ID",
            });
        }

        const investigation = await investigationfunction(incidentId);

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