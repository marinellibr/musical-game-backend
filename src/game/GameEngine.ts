import { generateId } from "../utils/ids";
import themeSelector from "./themeSelector";
import { env } from "../config/env";

export default class GameEngine {
  // This is a simplified in-memory facade — main state stored in Redis in full implementation

  static createRoom() {
    // placeholder
    return;
  }

  static startGame(room: any) {
    const sessionId = generateId("session");
    const theme = themeSelector.pickTheme(new Set());
    const roundEndsAt = Date.now() + 1000 * 60 * 3; // 3 minutes
    return { sessionId, theme, roundEndsAt };
  }
}
