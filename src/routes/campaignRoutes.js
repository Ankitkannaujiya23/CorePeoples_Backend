const express = require("express");
const {
  getCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaignStatus,
  deleteCampaign,
  duplicateCampaign,
  getPublicSubmissions,
} = require("../controllers/campaignController");
const { submitVote } = require("../controllers/voteController");
const { submitResponse, getMyResponse, getResponses } = require("../controllers/voteReviewController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

router.get("/", getCampaigns);
router.get("/:id", getCampaignById);
router.post("/", requireRole("admin"), createCampaign);
router.patch("/:id", requireRole("admin"), updateCampaignStatus);
router.patch("/:id/status", requireRole("admin"), updateCampaignStatus);
router.delete("/:id", requireRole("admin"), deleteCampaign);
router.post("/:id/duplicate", requireRole("admin"), duplicateCampaign);

router.post("/:id/vote", requireRole("employee"), submitVote);

router.post("/:id/responses", requireRole("employee"), submitResponse);
router.get("/:id/my-response", getMyResponse);
router.get("/:id/responses", requireRole("admin"), getResponses);

// Admin view of public-link submissions (the actual public submit
// endpoint lives in publicRoutes.js, unauthenticated)
router.get("/:id/public-submissions", requireRole("admin"), getPublicSubmissions);

module.exports = router;