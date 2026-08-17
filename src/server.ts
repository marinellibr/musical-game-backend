import "./config/env";
import { createServer } from "http";
import app from "./app";
import { initSocket } from "./socket/socketServer";
import logger from "pino";
import { getRedis } from "./config/redis";
import { connectMongo, closeMongo } from "./config/mongo";

const log = logger();

const port = process.env.PORT || 3000;

const server = createServer(app);

initSocket(server);

async function start() {
  await connectMongo();
  server.listen(port, () => {
    log.info({ port }, "Server started");
  });
}

start().catch((err) => log.error(err));

async function shutdown(signal: string) {
  log.info({ signal }, "Shutting down");
  try {
    server.close();
    const redis = getRedis();
    if (redis) await redis.quit();
    await closeMongo();
  } catch (e) {
    log.error(e);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
