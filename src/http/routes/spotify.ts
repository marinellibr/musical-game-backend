import { Router } from "express";
import { env } from "../../config/env";
import { getSpotifyAlbumTracks, spotifySearch, SpotifyAlbumSummary, SpotifyTrack } from "../../integrations/spotify/spotifyClient";

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
  const q = String(req.query.q || "");
  if (q.trim().length < 2) return res.json({ query: q, items: [] });
  try {
    const result = await spotifySearch(q.trim());
    return res.json({ query: q, items: (result.tracks?.items || []).map((track) => publicTrack(track)) });
  } catch {
    return res.status(503).json({ error: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify search is unavailable" } });
  }
});

router.get("/albums/:albumId/tracks", async (req, res) => {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return res.status(503).json({ error: { code: "SPOTIFY_NOT_CONFIGURED", message: "Spotify credentials not configured" } });
  try {
    const result = await getSpotifyAlbumTracks(req.params.albumId);
    return res.json({ albumId: req.params.albumId, items: result.items.map((track) => publicTrack(track, result.album)) });
  } catch {
    return res.status(503).json({ error: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify album is unavailable" } });
  }
});

function publicTrack(track: SpotifyTrack, album?: SpotifyAlbumSummary) {
  return { trackId: track.id, trackUri: track.uri, title: track.name, artist: track.artists?.map((artist) => artist.name).filter(Boolean).join(", "), album: track.album?.name || album?.name, albumId: track.album?.id || album?.id, image: track.album?.images?.[0]?.url || album?.images?.[0]?.url };
}

export default router;
