import { Router } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import spotifyRouter from "./spotify";
import youtubeRouter from "./youtube";
import categoriesRouter from "./categories";

const router = Router();

router.use("/health", healthRouter);
router.use("/rooms", roomsRouter);
router.use("/spotify", spotifyRouter);
router.use("/youtube", youtubeRouter);
router.use("/game-categories", categoriesRouter);

export { router };
