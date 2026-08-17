import { Router } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import spotifyRouter from "./spotify";
import youtubeRouter from "./youtube";

const router = Router();

router.use("/health", healthRouter);
router.use("/rooms", roomsRouter);
router.use("/spotify", spotifyRouter);
router.use("/youtube", youtubeRouter);

export { router };
