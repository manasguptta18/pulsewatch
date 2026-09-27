import {app} from "./app.js";
import { startMonitorScheduler } from "./services/monitor.scheduler.js";

const port = 3000;

app.listen(port, ()=>{
    console.log(`server running on port ${port}`);
});

startMonitorScheduler();