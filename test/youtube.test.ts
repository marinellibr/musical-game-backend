import { describe, it, expect } from "vitest";
import { parseYouTubeId, parseYouTubeTimestamp, parseYouTubeUrl } from "../src/utils/youtube";

describe("youtube parser", () => {
  it("parses watch urls", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=abc123")).toBe(
      "abc123",
    );
  });
  it("parses youtu.be", () => {
    expect(parseYouTubeId("https://youtu.be/xyz")).toBe("xyz");
  });
  it("parses shorts", () => {
    expect(parseYouTubeId("https://www.youtube.com/shorts/shortid")).toBe(
      "shortid",
    );
  });
  it("parses mobile and embed urls", () => {
    expect(parseYouTubeId("https://m.youtube.com/watch?v=mobile")).toBe("mobile");
    expect(parseYouTubeId("https://www.youtube.com/embed/embedded")).toBe("embedded");
  });
  it("normalizes numeric and duration timestamps", () => {
    expect(parseYouTubeUrl("https://youtu.be/abc?t=184")?.startTime).toBe(184);
    expect(parseYouTubeUrl("https://youtube.com/watch?v=abc&t=3m4s")?.startTime).toBe(184);
    expect(parseYouTubeTimestamp("1h2m30s")).toBe(3750);
    expect(parseYouTubeUrl("https://youtube.com/embed/abc?start=184")?.startTime).toBe(184);
  });
});
