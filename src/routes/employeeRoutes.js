const express = require("express");
const {
    getEmployees,
    getEmployeeById,
    createEmployee,
    updateEmployee,
    setEmployeeStatus,
    updateEmployeeCredentials,
} = require("../controllers/employeeController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

router.get("/", getEmployees);
router.get("/:id", getEmployeeById);

router.post("/", requireRole("admin"), createEmployee);
router.patch("/:id", requireRole("admin"), updateEmployee);
router.patch("/:id/status", requireRole("admin"), setEmployeeStatus);
router.patch("/:id/credentials", requireRole("admin"), updateEmployeeCredentials);

module.exports = router;