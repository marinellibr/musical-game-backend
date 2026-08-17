# Musical Game Backend

Backend for the Musical Party Game.

See `.env.example` for variables.

Run locally:

```bash
cd musical-game-backend
npm install
npm run dev
```

Build:

```bash
npm run build
npm start
```

## API documentation

With the backend running, the interactive Swagger UI is available at:

- `http://localhost:3000/docs`
- `https://musical-game-backend.onrender.com/docs` in production

The raw OpenAPI specification is available at `GET /openapi.json`. Keep
`src/docs/openapi.ts` synchronized whenever an HTTP route, payload, response,
or status code changes.

## Testing connections

Fill in `.env`, then run:

```bash
npm run test:connections
```

This checks the configured Redis and MongoDB connections, Spotify and YouTube
APIs, and the Express `GET /health` endpoint. The command exits with status 1
if one or more checks fail.

HTTP endpoints:

- `GET /health`
- `POST /rooms` -> create room
- `POST /rooms/:roomCode/join` -> join
- `GET /rooms/:roomCode` -> public room state
- `GET /spotify/search?q=` -> spotify search (integration)
- `GET /spotify/albums/:albumId/tracks` -> album-restricted track list
- `GET /youtube/metadata?url=` -> youtube metadata
- `GET /docs` -> Swagger UI
- `GET /openapi.json` -> OpenAPI specification

Socket.IO events are outside the OpenAPI protocol and remain documented in code.

Theme-selection Socket.IO events:

- `game:start` — host creates the persisted theme pool and opens round 1
- `theme:react` — player sends `{ reaction: "like" | "dislike" | null }`
- `theme:reaction` — server returns the player's private active reaction
- `theme:swap` — host rejects the candidate and consumes the next pooled theme
- `round:start` — host confirms the candidate and advances everyone to gameplay
- `room:state` — server broadcasts the typed public room/game state
- `submission:create` / `submission:status` — stores a typed player choice and returns its public media preview for stable reload rendering
- `listening:start`, `listening:previous`, `listening:next` — host controls anonymous grouped playback
- `listening:state` — broadcasts the current deduplicated public media
- `voting:start` — host opens voting after all groups were heard
- `voting:state` — sends an author-free, player-specific voting DTO
- `vote:submit` — accepts one liked and one disliked group ID
- `round:result` — broadcasts the persisted result snapshot with authors, votes, ranking, and cumulative leaderboard
- `result:next` — host advances the shared reveal from authors to votes and ranking
- `round:next` — host advances to the next theme, or to final results after the last round

Voting lasts 60 seconds using backend-owned `votingStartedAt` and
`votingEndsAt`. It closes idempotently when every active round participant has
voted or when the deadline expires. Rankings and the cumulative leaderboard use
likes minus dislikes, then likes descending and dislikes ascending; exact ties
share the same position. No separate round points are awarded.
