import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_SETTINGS,
  normalizeGameSettings,
} from "../src/game/gameTypes";

describe("normalizeGameSettings", () => {
  it("restores every default for legacy rooms without settings", () => {
    expect(normalizeGameSettings(undefined)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeGameSettings({})).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it("preserves valid values and fills only missing or invalid fields", () => {
    expect(normalizeGameSettings({ totalRounds: 5 })).toEqual({
      totalRounds: 5,
      choosingDurationSeconds: 180,
      selectedCategories: [],
    });
    expect(normalizeGameSettings({ choosingDurationSeconds: 540 })).toEqual({
      totalRounds: 10,
      choosingDurationSeconds: 540,
      selectedCategories: [],
    });
    expect(normalizeGameSettings({ totalRounds: 4 as 3 })).toEqual(
      DEFAULT_GAME_SETTINGS,
    );
  });
});
