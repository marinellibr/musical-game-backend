import { generateId } from "../utils/ids";
import themeSelector from "./themeSelector";
import { env } from "../config/env";
import { GameSettings, normalizeGameSettings } from "./gameTypes";

export default class GameEngine {
  // This is a simplified in-memory facade — main state stored in Redis in full implementation

  static createRoom() {
    // placeholder
    return;
  }

  static startGame(room: { settings?: GameSettings }) {
    const sessionId = generateId("session");
    const theme = themeSelector.pickTheme(new Set());
    const settings = normalizeGameSettings(room.settings);
    const roundEndsAt = Date.now() + settings.choosingDurationSeconds * 1000;
    return { sessionId, theme, roundEndsAt };
  }
}
