const express = require("express");
const {
  signup,
  login,
  getProfile,
  updateProfile,
  deleteAccount,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist
} = require("../controllers/controller.js");
const authMiddleware = require("../middlewares/middleware.js");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);

router.get("/profile", authMiddleware, getProfile);
router.put("/profile", authMiddleware, updateProfile);
router.delete("/profile", authMiddleware, deleteAccount);

router.get("/watchlist", authMiddleware, getWatchlist);
router.post("/watchlist", authMiddleware, addToWatchlist);
router.delete("/watchlist/:tmdbId", authMiddleware, removeFromWatchlist);

module.exports = router;
