import mongoose from "mongoose";
import { UpdateQuery } from "mongoose";
import { GameSettings, GameVersion } from "../game/gameTypes";

export interface GameSessionRecord {
  sessionId: string;
  roomCode: string;
  createdAt: Date;
  status: "LOBBY" | "ACTIVE" | "FINISHED";
  gameVersion: GameVersion;
  settings: GameSettings;
  finishedAt?: Date;
  players: unknown[];
  rounds: unknown[];
  finalRanking?: unknown[];
  summary?: Record<string, unknown>;
}

const Schema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    roomCode: String,
    createdAt: Date,
    status: { type: String, required: true, enum: ["LOBBY", "ACTIVE", "FINISHED"] },
    gameVersion: { type: String, required: true, enum: ["v1", "v2"], default: "v1" },
    settings: { totalRounds: Number, choosingDurationSeconds: Number, selectedCategories: [String] },
    finishedAt: Date,
    players: Array,
    rounds: Array,
    finalRanking: Array,
    summary: Object,
  },
  { collection: "game_sessions" },
);

const Model =
  mongoose.models.GameSession || mongoose.model("GameSession", Schema);

export default class MongoSessionRepository {
  async create(session: GameSessionRecord) {
    const doc = new Model(session);
    return doc.save();
  }

  async update(sessionId: string, patch: UpdateQuery<GameSessionRecord>) {
    return Model.findOneAndUpdate({ sessionId }, patch, { new: true });
  }

  async find(sessionId: string) {
    return Model.findOne({ sessionId }).lean();
  }
}
