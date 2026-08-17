import { Router } from "express";
import MongoThemeRepository from "../../repositories/MongoThemeRepository";

const router = Router();
const themes = new MongoThemeRepository();

router.get("/", async (_req, res, next) => {
  try {
    return res.json({ items: await themes.listCategories() });
  } catch (error) {
    return next(error);
  }
});

export default router;
