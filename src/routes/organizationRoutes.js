const express = require("express");
const { getMyOrganization, updateMyOrganization } = require("../controllers/organizationController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);
router.get("/me", getMyOrganization);
router.patch("/me", requireRole("admin"), updateMyOrganization);

module.exports = router;
