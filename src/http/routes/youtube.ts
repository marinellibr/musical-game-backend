import { Router } from "express";
import { parseYouTubeId } from "../../utils/youtube";
import { env } from "../../config/env";

const router = Router();

router.get("/metadata", async (req, res) => {
  const url = String(req.query.url || "");
  const id = parseYouTubeId(url);
  if (!id)
    return res
      .status(400)
      .json({ error: { code: "INVALID_URL", message: "Invalid YouTube URL" } });

  // If API key present we could fetch more info; otherwise return id
  if (!env.YOUTUBE_API_KEY) {
    return res.json({ videoId: id, title: null, description: null });
  }

  // minimal: client could call YouTube API if key exists (not implemented)
  res.json({ videoId: id });
});

export default router;
