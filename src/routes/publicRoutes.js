const express = require("express");
const { getPublicCampaign, submitPublicResponse } = require("../controllers/publicController");

const router = express.Router();

// Deliberately NOT behind requireAuth — anyone with the link can use these.
router.get("/campaigns/:token", getPublicCampaign);
router.post("/campaigns/:token/submit", submitPublicResponse);

module.exports = router;