import { Router } from "express";
import { getYouTubeVideoMetadata, parseYouTubeUrl } from "../../utils/youtube";
import { env } from "../../config/env";

const router = Router();

router.get("/metadata", async (req, res) => {
  const url = String(req.query.url || "");
  const parsed = parseYouTubeUrl(url);
  if (!parsed)
    return res
      .status(400)
      .json({ error: { code: "INVALID_URL", message: "Invalid YouTube URL" } });

  // If API key present we could fetch more info; otherwise return id
  if (!env.YOUTUBE_API_KEY) return res.status(503).json({ error: { code: "YOUTUBE_NOT_CONFIGURED", message: "YouTube integration is not configured" } });
  try {
    const metadata = await getYouTubeVideoMetadata(parsed.videoId, env.YOUTUBE_API_KEY);
    const item = metadata.items?.[0];
    if (!item?.snippet) return res.status(404).json({ error: { code: "VIDEO_NOT_FOUND", message: "Video not found" } });
    return res.json({ videoId: parsed.videoId, startTime: parsed.startTime, title: item.snippet.title, channel: item.snippet.channelTitle, thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null });
  } catch (error) {
    return res.status(503).json({ error: { code: "YOUTUBE_UNAVAILABLE", message: "Unable to verify video" } });
  }
});

export default router;
