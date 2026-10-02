const express = require("express");
const { login, createOrganization, logout, me } = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/login", login);
router.post("/signup", createOrganization);
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);

module.exports = router;
