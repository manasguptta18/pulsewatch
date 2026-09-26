import {Router} from "express";
import { investigationfunction } from "../services/investigation.service";
import { generateIncidentSummary } from "../services/ai.services.js";

const router = Router();


router.get("/:id/ai-summary", async (req,res)=>{
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
        console.log("AI SUMMARY ERROR:",error);

        res.status(500).json({
            messages: "Failed to generate AI summary",
        });
    }
})

export default router;