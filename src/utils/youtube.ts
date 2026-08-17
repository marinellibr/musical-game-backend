export interface ParsedYouTubeUrl { videoId: string; startTime: number; }

export function parseYouTubeTimestamp(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

export function parseYouTubeUrl(url: string): ParsedYouTubeUrl | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    let videoId: string | null = null;
    if (u.hostname.includes("youtu.be")) {
      videoId = u.pathname.split("/").filter(Boolean)[0] || null;
    } else if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/shorts/") || u.pathname.startsWith("/embed/")) videoId = u.pathname.split("/")[2] || null;
      else videoId = u.searchParams.get("v");
    }
    if (!videoId) return null;
    return { videoId, startTime: parseYouTubeTimestamp(u.searchParams.get("t") || u.searchParams.get("start")) };
  } catch (e) {
    return null;
  }
}

export function parseYouTubeId(url: string): string | null {
  return parseYouTubeUrl(url)?.videoId ?? null;
}

export async function getYouTubeVideoMetadata(
  videoId: string,
  apiKey: string,
  signal?: AbortSignal,
) {
  if (!apiKey) throw new Error("YouTube API key not configured");
  const params = new URLSearchParams({
    part: "snippet",
    id: videoId,
    key: apiKey,
  });
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
    { signal },
  );
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message || detail;
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    throw new Error(`YouTube API failed (HTTP ${response.status}): ${detail}`);
  }
  return (await response.json()) as {
    items?: Array<{ id?: string; snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } } }>;
  };
}
