const CATEGORY_PRESENTATION: Record<string, { label: string; description: string }> = {
  INSTRUMENTS: { label: "Instrumentos", description: "Instrumentos, performances e momentos musicais." },
  VOCALS: { label: "Vocais", description: "Vozes, interpretações e performances vocais." },
  EMOTIONS: { label: "Emoções", description: "Músicas ligadas a sentimentos e memórias." },
  SITUATIONS: { label: "Situações", description: "Músicas perfeitas para diferentes momentos." },
  CHAOS: { label: "Caos", description: "Escolhas intensas, imprevisíveis e fora do comum." },
  CINEMA: { label: "Cinema", description: "Momentos musicais ligados ao cinema." },
  HOT_TAKE: { label: "Hot Takes", description: "Opiniões musicais que rendem discussão." },
  HOT_TAKES: { label: "Hot Takes", description: "Opiniões musicais que rendem discussão." },
  NOSTALGIA: { label: "Nostalgia", description: "Músicas que transportam para outras épocas." },
  LIVE: { label: "Ao vivo", description: "Performances e gravações que funcionam melhor ao vivo." },
  ARTIST: { label: "Artistas", description: "Temas dedicados a artistas e suas discografias." },
  ALBUM: { label: "Álbuns", description: "Faixas e momentos marcantes de álbuns." },
  BRAZIL: { label: "Brasil", description: "Música brasileira em diferentes estilos e épocas." },
  COVERS: { label: "Covers", description: "Releituras e novas versões de músicas conhecidas." },
  LYRICS: { label: "Letras", description: "Letras, versos e histórias contadas por músicas." },
  DISCOVERY: { label: "Descobertas", description: "Faixas e artistas que merecem ser descobertos." },
  SOUNDTRACKS: { label: "Trilhas sonoras", description: "Músicas marcantes de filmes, séries e jogos." },
  GENERATIONS: { label: "Gerações", description: "Músicas que definiram épocas e gerações." },
  DANCE: { label: "Dança", description: "Faixas feitas para movimentar a pista." },
  REMIXES: { label: "Remixes", description: "Remixes e versões que transformam a original." },
  MUSIC_VIDEOS: { label: "Videoclipes", description: "Clipes e momentos visuais inesquecíveis." },
};

export function categoryPresentation(id: string) {
  return CATEGORY_PRESENTATION[id] || {
    label: id.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
    description: "Temas musicais desta categoria.",
  };
}
