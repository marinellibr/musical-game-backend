import mongoose from "mongoose";

const Schema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    roomCode: String,
    createdAt: Date,
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
  async create(session: any) {
    const doc = new Model(session);
    return doc.save();
  }

  async update(sessionId: string, patch: any) {
    return Model.findOneAndUpdate({ sessionId }, patch, { new: true });
  }

  async find(sessionId: string) {
    return Model.findOne({ sessionId }).lean();
  }
}
