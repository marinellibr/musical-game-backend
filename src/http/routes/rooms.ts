import { Router } from "express";
import RoomController from "../controllers/RoomController";

const router = Router();

router.post("/", RoomController.createRoom);
router.post("/:roomCode/join", RoomController.joinRoom);
router.get("/:roomCode", RoomController.getRoom);

export default router;
