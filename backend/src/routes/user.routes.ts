import {Router} from "express";
import { createUser } from "../services/user.service.js";

const router = Router();

router.post("/",async (req,res)=>{
    try{
        const user = await createUser(req.body);
        res.status(201).json(user);
    }catch(error){
        console.log(error);
        res.status(500).json({
            message: "failed to create user",
        });
    }
});

export default router;