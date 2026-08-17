import { Theme } from "./gameTypes";
import { generateId } from "../utils/ids";

const THEMES: Theme[] = [
  {
    id: generateId("theme"),
    title: "Melhor virada de bateria",
    type: "MOMENT",
    source: "YOUTUBE",
  },
  {
    id: generateId("theme"),
    title: "Melhor coral",
    type: "MOMENT",
    source: "YOUTUBE",
  },
  {
    id: generateId("theme"),
    title: "Melhor mudança de tom",
    type: "MOMENT",
    source: "YOUTUBE",
  },
  {
    id: generateId("theme"),
    title: "Melhor feat escondido",
    type: "MOMENT",
    source: "YOUTUBE",
  },
  {
    id: generateId("theme"),
    title: "Melhor música para dirigir à noite",
    type: "MUSIC",
    source: "SPOTIFY",
  },
  {
    id: generateId("theme"),
    title: "Música mais triste",
    type: "MUSIC",
    source: "SPOTIFY",
  },
  {
    id: generateId("theme"),
    title: "Melhor música para pegar estrada",
    type: "MUSIC",
    source: "SPOTIFY",
  },
  {
    id: generateId("theme"),
    title: "Melhor álbum de 90s",
    type: "ALBUM",
    source: "SPOTIFY",
    sourceReference: "album_123",
  },
];

export function pickTheme(usedIds: Set<string> = new Set()): Theme | null {
  const available = THEMES.filter((t) => !usedIds.has(t.id));
  if (available.length === 0) return null;
  const idx = Math.floor(Math.random() * available.length);
  return available[idx];
}

export default { THEMES, pickTheme };
