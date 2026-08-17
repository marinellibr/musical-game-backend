import dotenv from "dotenv";
import process from "process";

dotenv.config();

export const env = {
  PORT: process.env.PORT || "3000",
  NODE_ENV: process.env.NODE_ENV || "development",
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "http://localhost:4200",
  REDIS_URL: process.env.REDIS_URL || "",
  MONGODB_URI: process.env.MONGODB_URI || "",
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID || "",
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET || "",
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || "",
  ROOM_TTL_SECONDS: Number(process.env.ROOM_TTL_SECONDS || "21600"),
};

export const corsOrigins = Array.from(
  new Set(
    [
      "http://localhost:4200",
      "https://marinellibr.github.io",
      ...env.FRONTEND_ORIGIN.split(",").map((origin) => origin.trim()),
    ].filter(Boolean),
  ),
);

if (!env.REDIS_URL) {
  // we'll allow startup but log when used
}

export default env;
