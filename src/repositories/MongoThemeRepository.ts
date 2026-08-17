import mongoose from "mongoose";
import { GameCategory, GameTheme } from "../game/gameTypes";
import { categoryPresentation } from "../game/categoryMetadata";

interface ThemeDocument {
  _id: unknown;
  title: string;
  type: string;
  category?: string;
  example?: string;
  sourceReference?: { provider: string; resourceType: string; id: string };
}

const themeSchema = new mongoose.Schema<ThemeDocument>(
  {
    _id: { type: mongoose.Schema.Types.Mixed, required: true },
    title: { type: String, required: true },
    type: { type: String, required: true },
    category: String,
    example: String,
    sourceReference: mongoose.Schema.Types.Mixed,
  },
  { collection: "gameThemes", strict: false },
);

const ThemeModel =
  mongoose.models.GameTheme || mongoose.model<ThemeDocument>("GameTheme", themeSchema);

export default class MongoThemeRepository {
  private categoriesCache: { expiresAt: number; value: GameCategory[] } | null = null;

  async listCategories(): Promise<GameCategory[]> {
    if (this.categoriesCache && this.categoriesCache.expiresAt > Date.now()) return this.categoriesCache.value;
    const rows = await ThemeModel.aggregate<{ _id: string; examples: Array<{ id: unknown; title: string }> }>([
      { $match: { category: { $type: "string", $ne: "" }, title: { $type: "string" }, type: { $type: "string" } } },
      { $sort: { _id: 1 } },
      { $group: { _id: "$category", examples: { $push: { id: "$_id", title: "$title" } } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 1, examples: { $slice: ["$examples", 3] } } },
    ]);
    const value = rows.map((row) => ({
      id: row._id,
      ...categoryPresentation(row._id),
      examples: row.examples.map((example) => ({ id: String(example.id), title: example.title })),
    }));
    this.categoriesCache = { expiresAt: Date.now() + 5 * 60_000, value };
    return value;
  }

  async balancedPool(categories: string[], size: number, excludedIds: string[] = []): Promise<GameTheme[]> {
    const documents = await ThemeModel.find({
      category: { $in: categories },
      ...(excludedIds.length > 0 ? { _id: { $nin: excludedIds } } : {}),
      title: { $type: "string" },
      type: { $type: "string" },
    }).lean<ThemeDocument[]>();
    const groups = new Map<string, ThemeDocument[]>();
    for (const document of documents) {
      if (!document.category) continue;
      const group = groups.get(document.category) || [];
      group.push(document);
      groups.set(document.category, group);
    }
    const shuffle = <T>(items: T[]) => items
      .map((value) => ({ value, order: Math.random() }))
      .sort((a, b) => a.order - b.order)
      .map(({ value }) => value);
    const categoryOrder = shuffle(categories.filter((category) => groups.has(category)));
    for (const category of categoryOrder) groups.set(category, shuffle(groups.get(category) || []));
    const picked: ThemeDocument[] = [];
    while (picked.length < size) {
      let added = false;
      for (const category of categoryOrder) {
        const next = groups.get(category)?.shift();
        if (next) { picked.push(next); added = true; }
        if (picked.length === size) break;
      }
      if (!added) break;
    }
    return picked.map(toGameTheme);
  }

  async randomPool(size: number, excludedIds: string[] = []): Promise<GameTheme[]> {
    const match = excludedIds.length > 0 ? { _id: { $nin: excludedIds } } : {};
    const documents = await ThemeModel.aggregate<ThemeDocument>([
      { $match: { ...match, title: { $type: "string" }, type: { $type: "string" } } },
      { $sample: { size } },
      { $project: { _id: 1, title: 1, type: 1, category: 1, example: 1, sourceReference: 1 } },
    ]);
    return documents.map(toGameTheme);
  }
}

function toGameTheme(theme: ThemeDocument): GameTheme {
  return {
    id: String(theme._id), title: theme.title, type: theme.type,
    ...(theme.category ? { category: theme.category } : {}),
    ...(theme.example ? { example: theme.example } : {}),
    ...(theme.sourceReference ? { sourceReference: theme.sourceReference } : {}),
  };
}
