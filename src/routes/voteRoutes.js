const express = require("express");
const { getMyVotes } = require("../controllers/voteController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/me", requireAuth, getMyVotes);

module.exports = router;
