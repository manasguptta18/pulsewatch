import {Router} from "express";
import {createMonitor , checkMonitor, } from '../services/monitor.service';

const router = Router();

router.post("/", async(req,res)=>{
    try{
        const monitor = await createMonitor(req.body);
        res.status(201).json(monitor);
    
    }catch(error){
        res.status(500).json({
            message: "Failed to create monitor",
        });
    }
});

router.post("/:id/check", async (req, res)=>{
    try{
        const monitorId = Number(req.params.id);
        const check = await checkMonitor(monitorId);

        res.status(201).json(check);
    }catch(error){
        console.error("CHECK MONITOR ERROR:", error);
        res.status(500).json({
            message: "failed to check monitor",
        });
    }
});

export default router;