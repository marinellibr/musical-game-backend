import mongoose from "mongoose";
import { env } from "./env";
import logger from "pino";

const log = logger();

export async function connectMongo(serverSelectionTimeoutMS?: number) {
  if (!env.MONGODB_URI) {
    log.warn(
      "MONGODB_URI not configured — MongoDB features will be disabled until configured",
    );
    return;
  }
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS });
  log.info("MongoDB connected");
}

export async function closeMongo() {
  await mongoose.disconnect();
}
