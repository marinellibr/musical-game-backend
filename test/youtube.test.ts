import { describe, it, expect } from "vitest";
import { parseYouTubeId } from "../src/utils/youtube";

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
});
