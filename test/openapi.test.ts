import { describe, expect, it } from "vitest";
import { openApiDocument } from "../src/docs/openapi";

describe("OpenAPI documentation", () => {
  it("describes every current HTTP route", () => {
    expect(openApiDocument.openapi).toBe("3.0.3");
    expect(Object.keys(openApiDocument.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/rooms",
        "/rooms/{roomCode}/join",
        "/rooms/{roomCode}",
        "/spotify/search",
        "/youtube/metadata",
      ]),
    );
  });
});
