import Redis from "ioredis";
import { ClusterManager } from "../utils/cluster-manager";
import { DEFAULT_PLAYGROUND_CONFIG } from "../utils/config";

const NODE_COUNT = 5;

export async function runDashboard() {
  const manager = new ClusterManager(`observatory-${process.pid}`);
  const dashboard = (await manager.enableDashboard(true))!;
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    dashboard.ready = false;
    if (manager.getAllNodes().length) await manager.cleanup();
    await dashboard.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  const redis = new Redis({
    host: DEFAULT_PLAYGROUND_CONFIG.cluster.redisHost,
    port: DEFAULT_PLAYGROUND_CONFIG.cluster.redisPort,
    connectTimeout: 1500,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  redis.on("error", () => {});
  try {
    await redis.connect();
    await redis.ping();
    redis.disconnect();
    await manager.createCluster(NODE_COUNT);
    await manager.appendToLeader({ type: "increment", value: 1 });
    dashboard.ready = true;
    dashboard.status = "running";
    dashboard.journal.publish("ready", "studio", {
      message: `${NODE_COUNT} nodes. One shared truth. Your cluster is ready.`,
    });
  } catch (error) {
    redis.disconnect();
    dashboard.status = "error";
    const message = `Could not start the cluster. Check REDIS_HOST / REDIS_PORT and Redis availability. ${String(error)}`;
    dashboard.journal.publish("error", "studio", { message });
    console.error(message);
  }
}

if (import.meta.main)
  void runDashboard().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
