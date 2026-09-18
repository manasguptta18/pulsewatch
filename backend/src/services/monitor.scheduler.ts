import {prisma} from "../lib/prisma.js";
import {checkMonitor} from "./monitor.service.js";

export function startMonitorScheduler(){
    setInterval(async ()=>{
        try{
            const monitors = await prisma.monitor.findMany({
                where:{
                    isActive: true,
                },
            });

            for(const monitor of monitors){
                const latestCheck = await prisma.monitorCheck.findFirst({
                    where: {
                        monitorId: monitor.id,
                    },
                    orderBy:{
                        checkedAt: "desc",
                    },
                });

                const now = Date.now();

                if(!latestCheck || now-latestCheck.checkedAt.getTime() >= monitor.intervalSeconds*1000){
                    console.log(`Checking monitor: ${monitor.name}`);
                    await checkMonitor(monitor.id);
                }
            }
        }catch(error){
            console.error("Schedule error:", error);
        }
    }, 60*1000);
}