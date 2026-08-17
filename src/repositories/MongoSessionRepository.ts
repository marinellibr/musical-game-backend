import mongoose from "mongoose";
import { UpdateQuery } from "mongoose";
import { FinalAnalysis, GameSettings, HistoricalRound, LeaderboardEntry } from "../game/gameTypes";

export interface GameSessionRecord {
  sessionId: string;
  roomCode: string;
  createdAt: Date;
  status: "LOBBY" | "ACTIVE" | "FINISHED";
  settings: GameSettings;
  finishedAt?: Date;
  players: unknown[];
  rounds: HistoricalRound[] | unknown[];
  finalRanking?: LeaderboardEntry[] | unknown[];
  analysis?: FinalAnalysis;
  summary?: Record<string, unknown>;
}

const Schema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    roomCode: String,
    createdAt: Date,
    status: { type: String, required: true, enum: ["LOBBY", "ACTIVE", "FINISHED"] },
    // Read compatibility only: historical documents may still contain this field.
    gameVersion: { type: String, required: false, select: false },
    settings: { totalRounds: Number, choosingDurationSeconds: Number, selectedCategories: [String] },
    finishedAt: Date,
    players: Array,
    rounds: Array,
    finalRanking: Array,
    analysis: Object,
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

  async finalize(sessionId: string, snapshot: { finishedAt: Date; players: unknown[]; rounds: HistoricalRound[]; finalRanking: LeaderboardEntry[]; analysis: FinalAnalysis }) {
    const finalized = await Model.findOneAndUpdate(
      { sessionId, status: { $ne: "FINISHED" } },
      { $set: { status: "FINISHED", ...snapshot } },
      { new: true },
    ).lean();
    return finalized || Model.findOne({ sessionId }).lean();
  }

  async findResult(sessionId: string) {
    return Model.findOne({ sessionId, status: "FINISHED" })
      .select({ _id: 0, sessionId: 1, finalRanking: 1, analysis: 1 })
      .lean();
  }
}
