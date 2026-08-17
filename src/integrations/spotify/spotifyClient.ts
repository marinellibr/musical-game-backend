import { env } from "../../config/env";

const SPOTIFY_ACCOUNTS_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";

async function spotifyRequest(url: string, init: RequestInit, label: string) {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as {
        error?: string | { message?: string };
        error_description?: string;
      };
      detail =
        body.error_description ||
        (typeof body.error === "string" ? body.error : body.error?.message) ||
        detail;
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    throw new Error(`${label} failed (HTTP ${response.status}): ${detail}`);
  }
  return response;
}

export async function getSpotifyAccessToken(signal?: AbortSignal) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new Error("Spotify credentials not configured");
  }

  const credentials = Buffer.from(
    `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await spotifyRequest(
    SPOTIFY_ACCOUNTS_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      signal,
    },
    "Spotify authentication",
  );
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Spotify authentication returned no access token");
  return payload.access_token;
}

export async function spotifySearch(
  q: string,
  accessToken?: string,
  signal?: AbortSignal,
) {
  const token = accessToken || (await getSpotifyAccessToken(signal));
  const params = new URLSearchParams({ q, type: "track", limit: "5" });
  const response = await spotifyRequest(
    `${SPOTIFY_API_URL}/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
    "Spotify search",
  );
  return (await response.json()) as {
    tracks?: { items?: Array<{ id?: string; name?: string }> };
  };
}
