import Redis from "ioredis";
import { env } from "./env";
import logger from "pino";

const log = logger();

let client: Redis | null = null;

export function getRedis() {
  if (!client) {
    if (!env.REDIS_URL) {
      log.warn(
        "REDIS_URL not configured — Redis operations will fail until configured",
      );
    }
    client = new Redis(env.REDIS_URL);
    client.on("connect", () => log.info("Redis connected"));
    client.on("error", (err) => log.error({ err }, "Redis error"));
  }
  return client;
}
