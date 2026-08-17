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
- `GET /youtube/metadata?url=` -> youtube metadata

Socket.IO events documented in code.
