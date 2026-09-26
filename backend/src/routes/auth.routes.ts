import {Router} from "express";
import {loginUser} from "../services/auth.service";

const router = Router();

router.post("/login", async(req,res)=>{
    try{
        const result = await loginUser(req.body);

        res.json(result);
    }catch(error){
        console.log("LOGIN ERROR:", error);

        res.status(401).json({
            message: "Invalid email or password",
        });
    }
});

export default router;