import mongoose from "mongoose";
import { GameTheme } from "../game/gameTypes";

interface ThemeDocument {
  _id: unknown;
  title: string;
  type: string;
  category?: string;
}

const themeSchema = new mongoose.Schema<ThemeDocument>(
  {
    _id: { type: mongoose.Schema.Types.Mixed, required: true },
    title: { type: String, required: true },
    type: { type: String, required: true },
    category: String,
  },
  { collection: "gameThemes", strict: false },
);

const ThemeModel =
  mongoose.models.GameTheme || mongoose.model<ThemeDocument>("GameTheme", themeSchema);

export default class MongoThemeRepository {
  async randomPool(size: number, excludedIds: string[] = []): Promise<GameTheme[]> {
    const match = excludedIds.length > 0 ? { _id: { $nin: excludedIds } } : {};
    const documents = await ThemeModel.aggregate<ThemeDocument>([
      { $match: { ...match, title: { $type: "string" }, type: { $type: "string" } } },
      { $sample: { size } },
      { $project: { _id: 1, title: 1, type: 1, category: 1 } },
    ]);
    return documents.map((theme) => ({
      id: String(theme._id),
      title: theme.title,
      type: theme.type,
      ...(theme.category ? { category: theme.category } : {}),
    }));
  }
}
