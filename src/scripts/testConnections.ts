import mongoose from "mongoose";
import request from "supertest";
import app from "../app";
import { env } from "../config/env";
import { getRedis } from "../config/redis";
import { closeMongo, connectMongo } from "../config/mongo";
import {
  getSpotifyAccessToken,
  spotifySearch,
} from "../integrations/spotify/spotifyClient";
import { getYouTubeVideoMetadata } from "../utils/youtube";

const TIMEOUT_MS = 8_000;
let failures = 0;

function sanitizeError(error: unknown): string {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const raw = [
    error instanceof Error ? error.message : String(error),
    cause instanceof Error ? cause.message : "",
  ]
    .filter(Boolean)
    .join(": ");
  const secrets = [
    env.REDIS_URL,
    env.MONGODB_URI,
    env.SPOTIFY_CLIENT_ID,
    env.SPOTIFY_CLIENT_SECRET,
    env.YOUTUBE_API_KEY,
  ].filter(Boolean);
  let message = raw;
  if (/Invalid scheme, expected connection string/i.test(message)) {
    return "Invalid MongoDB URI scheme (expected mongodb:// or mongodb+srv://)";
  }
  for (const secret of secrets) message = message.split(secret).join("[REDACTED]");
  message = message.replace(
    /(redis(?:s)?|mongodb(?:\+srv)?):\/\/[^\s"')]+/gi,
    "$1://[REDACTED]",
  );
  if (/abort|timed? out/i.test(message)) return "Connection timeout";
  return message.replace(/\s+/g, " ").trim() || "Unknown error";
}

function hasUrlScheme(value: string, schemes: string[]) {
  try {
    const parsed = new URL(value);
    return schemes.includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function pass(label: string) {
  console.log(`✓ ${label}`);
}

function fail(label: string, error: unknown) {
  failures += 1;
  console.log(`✗ ${label}`);
  console.log(`  ${sanitizeError(error)}`);
}

async function check(label: string, task: () => Promise<void>) {
  try {
    await task();
    pass(label);
  } catch (error) {
    fail(label, error);
  }
}

async function withTimeout<T>(label: string, task: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} connection timeout`)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withAbortTimeout<T>(task: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("========================================");
  console.log(" Musical Game Backend Connection Check");
  console.log("========================================");

  console.log("Environment");
  const required = [
    "REDIS_URL",
    "MONGODB_URI",
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
    "YOUTUBE_API_KEY",
  ] as const;
  for (const name of required) {
    if (env[name]) pass(name);
    else fail(name, "Not configured");
  }

  console.log("Infrastructure");
  const redisUrlValid = hasUrlScheme(env.REDIS_URL, ["redis:", "rediss:"]);
  // Importing the Express app constructs the existing room repository, so the
  // shared Redis singleton already exists even when its URL is malformed.
  const redis = getRedis();
  redis.removeAllListeners("error");
  redis.on("error", () => undefined);
  if (!redisUrlValid) redis.disconnect();
  let redisConnected = false;
  await check("Redis connected", async () => {
    if (!env.REDIS_URL) throw new Error("REDIS_URL not configured");
    if (!redisUrlValid) {
      throw new Error("Invalid REDIS_URL scheme (expected redis:// or rediss://)");
    }
    const pong = await withTimeout("Redis", redis.ping());
    if (pong !== "PONG") throw new Error(`Unexpected PING response: ${pong}`);
    redisConnected = true;
  });
  await check("Redis read/write", async () => {
    if (!env.REDIS_URL) throw new Error("REDIS_URL not configured");
    if (!redisUrlValid) {
      throw new Error("Invalid REDIS_URL scheme (expected redis:// or rediss://)");
    }
    if (!redisConnected) throw new Error("Redis connection did not succeed");
    const key = `musical-game:connection-test:${process.pid}:${Date.now()}`;
    const value = `${Date.now()}-${Math.random()}`;
    try {
      await withTimeout("Redis", redis.set(key, value, "EX", 30));
      const stored = await withTimeout("Redis", redis.get(key));
      if (stored !== value) throw new Error("Redis read did not match written value");
    } finally {
      await withTimeout("Redis cleanup", redis.del(key)).catch(() => undefined);
    }
  });

  let mongoConnected = false;
  await check("MongoDB connected", async () => {
    if (!env.MONGODB_URI) throw new Error("MONGODB_URI not configured");
    if (!hasUrlScheme(env.MONGODB_URI, ["mongodb:", "mongodb+srv:"])) {
      throw new Error("Invalid MongoDB URI scheme (expected mongodb:// or mongodb+srv://)");
    }
    await connectMongo(TIMEOUT_MS);
    mongoConnected = mongoose.connection.readyState === 1;
    if (!mongoConnected) throw new Error("MongoDB connection is not ready");
  });
  await check("MongoDB ping", async () => {
    if (!mongoConnected || !mongoose.connection.db) throw new Error("MongoDB is not connected");
    const result = await withTimeout(
      "MongoDB",
      mongoose.connection.db.admin().command({ ping: 1 }),
    );
    if (result.ok !== 1) throw new Error("MongoDB ping returned an unexpected result");
  });

  console.log("External APIs");
  let spotifyToken: string | undefined;
  await check("Spotify authentication", async () => {
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
      throw new Error("Spotify credentials not configured");
    }
    spotifyToken = await withAbortTimeout((signal) => getSpotifyAccessToken(signal));
  });
  await check("Spotify search", async () => {
    if (!spotifyToken) throw new Error("Spotify authentication did not succeed");
    const result = await withAbortTimeout((signal) =>
      spotifySearch("Misery Business Paramore", spotifyToken, signal),
    );
    if (!result.tracks?.items?.some((item) => item.id && item.name)) {
      throw new Error("Spotify search returned no valid tracks");
    }
  });

  await check("YouTube API", async () => {
    if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY not configured");
    const result = await withAbortTimeout((signal) =>
      getYouTubeVideoMetadata("dQw4w9WgXcQ", env.YOUTUBE_API_KEY, signal),
    );
    if (!result.items?.some((item) => item.id && item.snippet?.title)) {
      throw new Error("YouTube API returned no valid video metadata");
    }
  });

  console.log("Application");
  await check("HTTP /health", async () => {
    const response = await withTimeout("HTTP", request(app).get("/health"));
    if (response.status !== 200 || response.body?.status !== "ok") {
      throw new Error(`Unexpected health response (HTTP ${response.status})`);
    }
  });

  if (redisConnected) {
    try {
      await withTimeout("Redis shutdown", redis.quit());
    } catch {
      redis.disconnect();
    }
  } else {
    redis.disconnect();
  }
  await closeMongo().catch((error) => fail("MongoDB disconnect", error));

  console.log("========================================");
  console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
  console.log("========================================");
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(async (error) => {
  fail("Connection check", error);
  await closeMongo().catch(() => undefined);
  process.exitCode = 1;
});
