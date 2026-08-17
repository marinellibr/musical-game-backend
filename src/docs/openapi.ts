export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Musical Game API",
    version: "1.0.0",
    description:
      "API HTTP do Musical Game. A sincronização em tempo real da sala é feita por Socket.IO.",
  },
  "x-socket-events": {
    "game:start": {
      description: "Host inicia a partida quando existem pelo menos 3 jogadores; sessões V2 também exigem ao menos 2 categorias válidas.",
    },
    "game:settings:update": {
      description: "Host atualiza os presets da partida enquanto a sala está no lobby.",
      payload: { $ref: "#/components/schemas/GameSettings" },
    },
    "game:restart": {
      description: "Host cria uma nova sessão na mesma room após GAME_RESULTS.",
    },
    "listening:next / listening:previous": {
      description: "Host altera o índice authoritative da mídia em LISTENING. Na V2, avançar a última mídia encerra a audição sem iniciar VOTING.",
    },
    "listening:ready:set": {
      description: "Player non-host ACTIVE da rodada V2 marca ou desfaz readiness após o encerramento da audição.",
      payload: { type: "object", required: ["ready"], properties: { ready: { type: "boolean" } } },
    },
    "listening:state": {
      description: "Estado authoritative de audição transmitido para toda a sala, incluindo mídia atual e readiness V2.",
      payload: { $ref: "#/components/schemas/PublicListeningState" },
    },
    "voting:start": {
      description: "Host inicia VOTING. Na V2 exige audição encerrada e ao menos um non-host elegível pronto, exceto quando não existe non-host elegível.",
    },
  },
  servers: [
    { url: "http://localhost:3000", description: "Desenvolvimento local" },
    {
      url: "https://musical-game-backend.onrender.com",
      description: "Produção",
    },
  ],
  tags: [
    { name: "Health", description: "Saúde da aplicação" },
    { name: "Rooms", description: "Criação, entrada e consulta de salas" },
    { name: "Spotify", description: "Integração com Spotify" },
    { name: "YouTube", description: "Integração com YouTube" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Verifica se a API está disponível",
        responses: {
          "200": {
            description: "API disponível",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/rooms": {
      post: {
        tags: ["Rooms"],
        summary: "Cria uma sala",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateRoomRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Sala criada e sessão do host retornada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RoomEntryResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidPayload" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/rooms/{roomCode}/join": {
      post: {
        tags: ["Rooms"],
        summary: "Entra em uma sala",
        parameters: [{ $ref: "#/components/parameters/RoomCode" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/JoinRoomRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Sessão do jogador criada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RoomEntryResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidPayload" },
          "404": { $ref: "#/components/responses/RoomNotFound" },
          "409": {
            description: "Sala cheia",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/rooms/{roomCode}": {
      get: {
        tags: ["Rooms"],
        summary: "Consulta o estado público de uma sala",
        parameters: [{ $ref: "#/components/parameters/RoomCode" }],
        responses: {
          "200": {
            description: "Estado atual da sala",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RoomState" },
              },
            },
          },
          "404": { $ref: "#/components/responses/RoomNotFound" },
        },
      },
    },
    "/spotify/search": {
      get: {
        tags: ["Spotify"],
        summary: "Pesquisa músicas no Spotify",
        parameters: [
          {
            name: "q",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Texto da pesquisa",
          },
        ],
        responses: {
          "200": {
            description: "Resultados da pesquisa",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SpotifySearchResponse" },
              },
            },
          },
          "503": {
            description: "Credenciais do Spotify não configuradas",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/spotify/albums/{albumId}/tracks": {
      get: {
        tags: ["Spotify"], summary: "Lista as faixas permitidas de um álbum com nome e imagem da capa",
        parameters: [{ name: "albumId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Faixas do álbum", content: { "application/json": { schema: { type: "object", properties: { albumId: { type: "string" }, items: { type: "array", items: { $ref: "#/components/schemas/SpotifyTrack" } } } } } } }, "503": { $ref: "#/components/responses/InternalError" } },
      },
    },
    "/game-categories": {
      get: {
        tags: ["Rooms"],
        summary: "Lista categorias disponíveis com até 3 exemplos reais",
        responses: {
          "200": {
            description: "Categorias derivadas dos temas existentes",
            content: { "application/json": { schema: { type: "object", required: ["items"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/GameCategory" } } } } } },
          },
        },
      },
    },
    "/youtube/metadata": {
      get: {
        tags: ["YouTube"],
        summary: "Extrai os metadados de uma URL do YouTube",
        parameters: [
          {
            name: "url",
            in: "query",
            required: true,
            schema: { type: "string", format: "uri" },
            description: "URL do vídeo",
          },
        ],
        responses: {
          "200": {
            description: "Metadados disponíveis do vídeo",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/YouTubeMetadataResponse" },
              },
            },
          },
          "400": {
            description: "URL inválida",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      RoomCode: {
        name: "roomCode",
        in: "path",
        required: true,
        schema: { type: "string", example: "R78X" },
        description: "Código da sala, normalizado para letras maiúsculas",
      },
    },
    responses: {
      InvalidPayload: {
        description: "Corpo da requisição inválido",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      RoomNotFound: {
        description: "Sala não encontrada",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      InternalError: {
        description: "Erro interno",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      HealthResponse: {
        type: "object",
        required: ["status"],
        properties: { status: { type: "string", example: "ok" } },
      },
      CreateRoomRequest: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string", minLength: 1, maxLength: 32, example: "Ana" },
          isPlaying: { type: "boolean", default: true },
          gameVersion: { type: "string", enum: ["v1", "v2"], default: "v1" },
        },
      },
      JoinRoomRequest: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string", minLength: 1, maxLength: 32, example: "Bruno" },
        },
      },
      PublicPlayer: {
        type: "object",
        required: ["playerId", "username", "isHost", "isPlaying", "connected"],
        properties: {
          playerId: { type: "string", example: "player_123" },
          username: { type: "string", example: "Ana" },
          isHost: { type: "boolean" },
          isPlaying: { type: "boolean" },
          connected: { type: "boolean" },
          participationStatus: { type: "string", enum: ["ACTIVE", "WAITING_NEXT_ROUND"] },
        },
      },
      RoomState: {
        type: "object",
        required: ["roomCode", "status", "gameVersion", "host", "players", "settings"],
        properties: {
          roomCode: { type: "string", example: "R78X" },
          status: {
            type: "string",
            enum: [
              "LOBBY",
              "THEME_REVEAL",
              "CHOOSING",
              "LISTENING",
              "VOTING",
              "ROUND_RESULTS",
              "GAME_RESULTS",
              "GAME_SUMMARY",
            ],
          },
          gameVersion: { type: "string", enum: ["v1", "v2"] },
          host: { $ref: "#/components/schemas/PublicPlayer" },
          players: {
            type: "array",
            items: { $ref: "#/components/schemas/PublicPlayer" },
          },
          settings: { $ref: "#/components/schemas/GameSettings" },
          game: {
            nullable: true,
            allOf: [{ $ref: "#/components/schemas/PublicGameState" }],
          },
        },
      },
      GameTheme: {
        type: "object",
        required: ["id", "title", "type"],
        properties: {
          id: { type: "string", example: "melhor_virada_de_bateria" },
          title: { type: "string", example: "Melhor virada de bateria" },
          type: { type: "string", example: "MOMENT" },
          category: { type: "string", example: "INSTRUMENTS" },
          example: { type: "string" },
        },
      },
      GameSettings: {
        type: "object",
        required: ["totalRounds", "choosingDurationSeconds"],
        properties: {
          totalRounds: { type: "integer", enum: [3, 5, 10], default: 10 },
          choosingDurationSeconds: { type: "integer", enum: [180, 360, 540], default: 180 },
          selectedCategories: { type: "array", minItems: 2, uniqueItems: true, items: { type: "string" }, description: "Obrigatório para sessões V2" },
        },
      },
      GameCategory: {
        type: "object",
        required: ["id", "label", "description", "examples"],
        properties: {
          id: { type: "string" }, label: { type: "string" }, description: { type: "string" },
          examples: { type: "array", maxItems: 1, items: { type: "object", required: ["id", "title"], properties: { id: { type: "string" }, title: { type: "string" } } } },
        },
      },
      PublicListeningState: {
        type: "object",
        required: ["theme", "index", "total", "current", "finished", "votingEnabled", "readyPlayers", "readyCount", "eligibleReadyCount", "canStartVoting"],
        properties: {
          theme: { $ref: "#/components/schemas/GameTheme" }, index: { type: "integer", minimum: 0 }, total: { type: "integer", minimum: 0 },
          current: { nullable: true, $ref: "#/components/schemas/PublicMedia" }, finished: { type: "boolean" }, votingEnabled: { type: "boolean" },
          readyPlayers: { type: "array", items: { type: "object", required: ["playerId", "username", "ready"], properties: { playerId: { type: "string" }, username: { type: "string" }, ready: { type: "boolean" } } } },
          readyCount: { type: "integer", minimum: 0 }, eligibleReadyCount: { type: "integer", minimum: 0 }, canStartVoting: { type: "boolean" },
        },
      },
      PublicMedia: {
        type: "object", required: ["source", "title", "startTime", "externalUrl"],
        properties: { source: { type: "string", enum: ["SPOTIFY", "YOUTUBE"] }, title: { type: "string" }, artist: { type: "string", description: "Artistas no Spotify ou canal no YouTube" }, spotifyTrackId: { type: "string" }, youtubeVideoId: { type: "string" }, startTime: { type: "integer", minimum: 0 }, thumbnail: { type: "string" }, externalUrl: { type: "string", format: "uri" } },
      },
      PublicGameState: {
        type: "object",
        required: ["round", "totalRounds", "phase", "currentTheme", "likes", "dislikes", "reactedPlayers", "playersCount"],
        properties: {
          round: { type: "integer", minimum: 1, example: 1 },
          totalRounds: { type: "integer", minimum: 1, example: 10 },
          phase: { type: "string", enum: ["THEME_SELECTION", "CHOOSING", "LISTENING", "VOTING", "ROUND_RESULTS"] },
          currentTheme: { $ref: "#/components/schemas/GameTheme" },
          likes: { type: "integer", minimum: 0 },
          dislikes: { type: "integer", minimum: 0 },
          reactedPlayers: { type: "integer", minimum: 0 },
          playersCount: { type: "integer", minimum: 0 },
          roundStartedAt: { type: "integer", nullable: true }, roundEndsAt: { type: "integer", nullable: true }, submittedCount: { type: "integer", minimum: 0 }, waitingNextRoundCount: { type: "integer", minimum: 0 },
          leaderboard: { type: "array", items: { $ref: "#/components/schemas/LeaderboardEntry" } },
        },
      },
      RoomEntryResponse: {
        type: "object",
        required: ["roomCode", "player", "playerToken", "gameVersion"],
        properties: {
          roomCode: { type: "string", example: "R78X" },
          player: { $ref: "#/components/schemas/PublicPlayer" },
          playerToken: { type: "string", example: "token_123" },
          gameVersion: { type: "string", enum: ["v1", "v2"] },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", example: "ROOM_NOT_FOUND" },
              message: { type: "string", example: "Room not found" },
            },
          },
        },
      },
      SpotifySearchResponse: {
        type: "object",
        required: ["query", "items"],
        properties: {
          query: { type: "string" },
          items: { type: "array", items: { $ref: "#/components/schemas/SpotifyTrack" } },
        },
      },
      SpotifyTrack: { type: "object", required: ["trackId", "title"], properties: { trackId: { type: "string" }, trackUri: { type: "string" }, title: { type: "string" }, artist: { type: "string" }, album: { type: "string" }, albumId: { type: "string" }, image: { type: "string", format: "uri", description: "Imagem de capa da faixa ou do álbum" } } },
      LeaderboardEntry: { type: "object", required: ["playerId", "username", "totalLikes", "totalDislikes", "voteBalance", "position"], properties: { playerId: { type: "string" }, username: { type: "string" }, totalLikes: { type: "integer", minimum: 0 }, totalDislikes: { type: "integer", minimum: 0 }, voteBalance: { type: "integer" }, position: { type: "integer", minimum: 1 } } },
      YouTubeMetadataResponse: {
        type: "object",
        required: ["videoId"],
        properties: {
          videoId: { type: "string", example: "dQw4w9WgXcQ" },
          title: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          startTime: { type: "integer", minimum: 0 }, channel: { type: "string" }, thumbnail: { type: "string", nullable: true },
        },
      },
    },
  },
} as const;
