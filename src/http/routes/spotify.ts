import { Router } from "express";
import { env } from "../../config/env";

const router = Router();

router.get("/search", async (req, res) => {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    return res
      .status(503)
      .json({
        error: {
          code: "SPOTIFY_NOT_CONFIGURED",
          message: "Spotify credentials not configured",
        },
      });
  }
  // Stub: real implementation would call Spotify API
  const q = String(req.query.q || "");
  res.json({ query: q, items: [] });
});

export default router;
