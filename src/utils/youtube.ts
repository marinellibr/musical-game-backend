export function parseYouTubeId(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1);
    }
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
      return u.searchParams.get("v");
    }
    return null;
  } catch (e) {
    return null;
  }
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
    items?: Array<{ id?: string; snippet?: { title?: string } }>;
  };
}
