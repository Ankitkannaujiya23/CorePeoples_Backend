const pool = require("../db/pool");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

function toOrganization(row) {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    employeeCount: row.employee_count,
    plan: row.plan,
    createdAt: row.created_at,
  };
}

const getMyOrganization = asyncHandler(async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM organizations WHERE id = ? LIMIT 1", [
    req.user.organizationId,
  ]);
  if (!rows[0]) throw new AppError("Organization not found.", 404, "NOT_FOUND");
  res.json(toOrganization(rows[0]));
});

const updateMyOrganization = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    throw new AppError("Organization name is required.", 400, "MISSING_FIELDS");
  }

  await pool.query("UPDATE organizations SET name = ? WHERE id = ?", [
    name.trim(),
    req.user.organizationId,
  ]);

  const [rows] = await pool.query("SELECT * FROM organizations WHERE id = ? LIMIT 1", [
    req.user.organizationId,
  ]);
  res.json(toOrganization(rows[0]));
});

module.exports = { getMyOrganization, updateMyOrganization };
