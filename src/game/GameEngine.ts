import { generateId } from "../utils/ids";
import themeSelector from "./themeSelector";
import { env } from "../config/env";
import { DEFAULT_GAME_SETTINGS, GameSettings } from "./gameTypes";

export default class GameEngine {
  // This is a simplified in-memory facade — main state stored in Redis in full implementation

  static createRoom() {
    // placeholder
    return;
  }

  static startGame(room: { settings?: GameSettings }) {
    const sessionId = generateId("session");
    const theme = themeSelector.pickTheme(new Set());
    const settings = room.settings || DEFAULT_GAME_SETTINGS;
    const roundEndsAt = Date.now() + settings.choosingDurationSeconds * 1000;
    return { sessionId, theme, roundEndsAt };
  }
}
