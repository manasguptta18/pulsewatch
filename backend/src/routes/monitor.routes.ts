import {Router} from "express";
import {createMonitor} from '../services/monitor.service';

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

export default router;