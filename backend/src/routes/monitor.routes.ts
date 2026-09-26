import {Router} from "express";
import {createMonitor , checkMonitor, getUserMonitors, getMonitorByIdForUser,checkMonitorForUser,updateMonitorForUser, deleteMonitorForUser } from '../services/monitor.service';
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.post("/",authMiddleware, async(req,res)=>{
    try{
        const monitor = await createMonitor({
                userId: req.userId!,
                name: req.body.name,
                url: req.body.url,
        });
        res.status(201).json(monitor);
    
    }catch(error){
        res.status(500).json({
            message: "Failed to create monitor",
        });
    }
});

router.get("/",authMiddleware, async (req,res)=>{
    try{
        const monitors = await getUserMonitors(req.userId!);
        res.json(monitors);
    }catch(error){
        console.log("GET USER MONITORS ERROR",error);
        res.status(500).json({
            message: "failed to fetch monitors",
        });
    }
});

router.get("/:id", authMiddleware, async (req,res)=>{
    try{
        const monitorId = Number(req.params.id);

        if(!Number.isInteger(monitorId)){
            return res.status(400).json({
                message: "Invalid monitor ID",
            });
        }

        const monitor = await getMonitorByIdForUser(monitorId, req.userId!);

        res.json(monitor);
    }catch(error){
        console.log("GET MONITOR ERROR", error);

        res.status(404).json({
            message: "Monitor not found",
        });
    }
});

router.post("/:id/check", authMiddleware, async (req, res)=>{
    try{
        const monitorId = Number(req.params.id);

        if(!Number.isInteger(monitorId)){
            return res.status(400).json({
                message: "Invalid monitor ID",
            });
        }
        const check = await checkMonitorForUser(monitorId, req.userId!);

        res.status(201).json(check);
    }catch(error){
        console.error("CHECK MONITOR ERROR:", error);
        res.status(404).json({
            message: "Monitor not found",
        });
    }
});


router.patch("/:id", authMiddleware, async (req,res)=>{
    try{
        const monitorId = Number(req.params.id);

        if(!Number.isInteger(monitorId)){
            return res.status(400).json({
                message: "Invalid monitor ID",
            });
        }

        const monitor = await updateMonitorForUser(
            monitorId,
            req.userId!,
            req.body
        );

        res.json(monitor);
    }catch(error){
        console.error(
            "UPDATE MONITOR ERROR:",
            error
        );

        res.status(404).json({
            message: "Monitor not found",
        });
    }
});

router.delete("/:id", authMiddleware, async (req,res)=>{
    try{
        const monitorId = Number(req.params.id);

        if(!Number.isInteger(monitorId)){
            return res.status(400).json({
                message: "Invalid monitor ID",
            });
        }

        const result = await deleteMonitorForUser(
            monitorId,
            req.userId!
        );

        res.json(result);
    }catch(error){
        console.error(
                "DELETE MONITOR ERROR:",
                error
            );

        res.status(404).json({
                message: "Monitor not found",
            });
    }
});


export default router;