import {Router} from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { investigationfunction } from "../services/investigation.service.js";
import { generateIncidentSummary } from "../services/ai.services.js";
import { parsePositiveRouteId } from "../lib/route-id.js";
import { listUserIncidents } from "../services/incident-list.service.js";

const router = Router();

router.get("/", authMiddleware, async (req, res, next) => {
    try {
        const rawLimit = req.query.limit;
        const rawAfter = req.query.after;
        const rawStatus = req.query.status;
        const rawType = req.query.type;
        const limit = rawLimit === undefined
            ? 20
            : typeof rawLimit === "string" && /^[1-9]\d*$/.test(rawLimit)
                ? Number(rawLimit)
                : null;
        const afterId = rawAfter === undefined ? undefined : parsePositiveRouteId(rawAfter);
        const status = rawStatus === "ONGOING" || rawStatus === "RESOLVED" ? rawStatus : undefined;
        const type = rawType === "AVAILABILITY" || rawType === "PERFORMANCE" ? rawType : undefined;

        if (
            limit === null || !Number.isSafeInteger(limit) || limit > 100 ||
            (rawAfter !== undefined && afterId === null) ||
            (rawStatus !== undefined && !status) ||
            (rawType !== undefined && !type)
        ) {
            return res.status(400).json({ message: "Invalid incident query" });
        }

        const incidents = await listUserIncidents(req.userId!, {
            limit,
            ...(typeof afterId === "number" ? { afterId } : {}),
            ...(status ? { status } : {}),
            ...(type ? { type } : {}),
        });
        const hasMore = incidents.length > limit;
        const page = incidents.slice(0, limit);
        res.setHeader("X-Has-More", String(hasMore));
        if (hasMore) res.setHeader("X-Next-Cursor", String(page[page.length - 1]!.id));
        return res.json(page);
    } catch (error) {
        next(error);
    }
});


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
