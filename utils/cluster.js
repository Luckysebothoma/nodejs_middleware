import cluster from "cluster";
import { cpus } from "os";
import { startServer } from "./server.js";
import getShortTime from "./utils/time.js";

export function startCluster() {
  if (cluster.isPrimary) {
    const numCPUs = cpus().length;
    console.log(getShortTime(new Date) + ` Master process running on PID ${process.pid} with ${numCPUs} CPUs`);

    for (let i = 0; i < numCPUs - 2; i++) {
      cluster.fork();
    }

    cluster.on("exit", (worker) => {
      console.log(getShortTime(new Date) + ` Worker ${worker.process.pid} died. Restarting...`);
      cluster.fork();
    });
  } else {
    startServer();
  }
}
