const express =require("express");
const { signup, login } =require( "../controllers/controller.js");
const authMiddleware =require("../middlewares/middleware.js");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);

router.get("/profile", authMiddleware, (req, res) => {
  res.json({ userId: req.user.id, name: req.user.name });
});

module.exports = router;
