import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { router as routes } from "./http/routes";
import { errorHandler } from "./http/middleware/errorHandler";
import { corsOrigins } from "./config/env";
import logger from "pino";
import docsRouter from "./http/routes/docs";

const app = express();
const log = logger();

// Swagger UI uses an inline initialization script, so its routes are mounted
// before Helmet while the remaining API keeps the default security headers.
app.use(docsRouter);
app.use(helmet());
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: "100kb" }));
app.use(pinoHttp({ logger: log } as any));

app.use("/", routes);

app.use(errorHandler);

export default app;
