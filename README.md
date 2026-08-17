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

HTTP endpoints:

- `GET /health`
- `POST /rooms` -> create room
- `POST /rooms/:roomCode/join` -> join
- `GET /rooms/:roomCode` -> public room state
- `GET /spotify/search?q=` -> spotify search (integration)
- `GET /youtube/metadata?url=` -> youtube metadata

Socket.IO events documented in code.
