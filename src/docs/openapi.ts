export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Musical Game API",
    version: "1.0.0",
    description:
      "API HTTP do Musical Game. A sincronização em tempo real da sala é feita por Socket.IO.",
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
        },
      },
      RoomState: {
        type: "object",
        required: ["roomCode", "status", "host", "players"],
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
          host: { $ref: "#/components/schemas/PublicPlayer" },
          players: {
            type: "array",
            items: { $ref: "#/components/schemas/PublicPlayer" },
          },
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
        },
      },
      PublicGameState: {
        type: "object",
        required: ["round", "totalRounds", "phase", "currentTheme", "likes", "dislikes", "reactedPlayers", "playersCount"],
        properties: {
          round: { type: "integer", minimum: 1, example: 1 },
          totalRounds: { type: "integer", minimum: 1, example: 10 },
          phase: { type: "string", enum: ["THEME_SELECTION", "PLAYING"] },
          currentTheme: { $ref: "#/components/schemas/GameTheme" },
          likes: { type: "integer", minimum: 0 },
          dislikes: { type: "integer", minimum: 0 },
          reactedPlayers: { type: "integer", minimum: 0 },
          playersCount: { type: "integer", minimum: 0 },
        },
      },
      RoomEntryResponse: {
        type: "object",
        required: ["roomCode", "player", "playerToken"],
        properties: {
          roomCode: { type: "string", example: "R78X" },
          player: { $ref: "#/components/schemas/PublicPlayer" },
          playerToken: { type: "string", example: "token_123" },
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
          items: { type: "array", items: { type: "object" } },
        },
      },
      YouTubeMetadataResponse: {
        type: "object",
        required: ["videoId"],
        properties: {
          videoId: { type: "string", example: "dQw4w9WgXcQ" },
          title: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
        },
      },
    },
  },
} as const;
