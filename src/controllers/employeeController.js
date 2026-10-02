const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

function toEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    department: row.department,
    email: row.email,
    avatarColor: row.avatar_color,
    blurb: row.blurb,
    isActive: !!row.is_active,
  };
}

const getEmployees = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM employees WHERE organization_id = ? ORDER BY name ASC",
    [req.user.organizationId]
  );
  res.json(rows.map(toEmployee));
});

const getEmployeeById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM employees WHERE id = ? AND organization_id = ? LIMIT 1",
    [req.params.id, req.user.organizationId]
  );
  if (!rows[0]) throw new AppError("Employee not found.", 404, "NOT_FOUND");
  res.json(toEmployee(rows[0]));
});

// Admin adds a new employee — this creates both the employee record
// AND a login account for them (role: 'employee') in one step, since
// an employee with no login could never vote.
const createEmployee = asyncHandler(async (req, res) => {
  const { name, role, department, email, password, blurb, avatarColor } = req.body;

  if (!name?.trim() || !email?.trim() || !password) {
    throw new AppError("Name, email and password are required.", 400, "MISSING_FIELDS");
  }
  if (password.length < 8) {
    throw new AppError("Password must be at least 8 characters.", 400, "WEAK_PASSWORD");
  }

  const [existing] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing.length > 0) {
    throw new AppError("An account with this email already exists.", 409, "EMAIL_TAKEN");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const employeeId = randomUUID();
    const userId = randomUUID();
    const color = avatarColor || "#2A2E38";

    await conn.query(
      `INSERT INTO employees (id, organization_id, name, role, department, email, avatar_color, blurb, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [employeeId, req.user.organizationId, name.trim(), role || null, department || null, email.trim(), color, blurb || null]
    );

    const passwordHash = await bcrypt.hash(password, 10);
    await conn.query(
      `INSERT INTO users (id, organization_id, employee_id, name, email, password_hash, role, avatar_color)
       VALUES (?, ?, ?, ?, ?, ?, 'employee', ?)`,
      [userId, req.user.organizationId, employeeId, name.trim(), email.trim(), passwordHash, color]
    );

    await conn.commit();

    const [rows] = await pool.query("SELECT * FROM employees WHERE id = ?", [employeeId]);
    res.status(201).json(toEmployee(rows[0]));
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Update basic profile fields (name, role, department, blurb) — not
// login credentials, which go through updateEmployeeCredentials below.
const updateEmployee = asyncHandler(async (req, res) => {
  const { name, role, department, blurb } = req.body;

  const [existingRows] = await pool.query(
    "SELECT * FROM employees WHERE id = ? AND organization_id = ? LIMIT 1",
    [req.params.id, req.user.organizationId]
  );
  if (!existingRows[0]) throw new AppError("Employee not found.", 404, "NOT_FOUND");

  await pool.query(
    "UPDATE employees SET name = COALESCE(?, name), role = COALESCE(?, role), department = COALESCE(?, department), blurb = COALESCE(?, blurb) WHERE id = ?",
    [name || null, role || null, department || null, blurb || null, req.params.id]
  );

  if (name) {
    await pool.query("UPDATE users SET name = ? WHERE employee_id = ?", [name, req.params.id]);
  }

  const [rows] = await pool.query("SELECT * FROM employees WHERE id = ?", [req.params.id]);
  res.json(toEmployee(rows[0]));
});

// Activate / deactivate — a deactivated employee can't log in, but
// their historical votes and candidacy stay intact (nothing is deleted).
const setEmployeeStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== "boolean") {
    throw new AppError("isActive must be true or false.", 400, "INVALID_STATUS");
  }

  const [rows] = await pool.query(
    "SELECT id FROM employees WHERE id = ? AND organization_id = ? LIMIT 1",
    [req.params.id, req.user.organizationId]
  );
  if (!rows[0]) throw new AppError("Employee not found.", 404, "NOT_FOUND");

  await pool.query("UPDATE employees SET is_active = ? WHERE id = ?", [isActive, req.params.id]);
  res.json({ id: req.params.id, isActive });
});

// Admin resets an employee's login email and/or password.
const updateEmployeeCredentials = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() && !password) {
    throw new AppError("Provide a new email and/or password.", 400, "NOTHING_TO_UPDATE");
  }
  if (password && password.length < 8) {
    throw new AppError("Password must be at least 8 characters.", 400, "WEAK_PASSWORD");
  }

  const [rows] = await pool.query(
    "SELECT * FROM employees WHERE id = ? AND organization_id = ? LIMIT 1",
    [req.params.id, req.user.organizationId]
  );
  if (!rows[0]) throw new AppError("Employee not found.", 404, "NOT_FOUND");

  if (email?.trim()) {
    const [taken] = await pool.query(
      "SELECT id FROM users WHERE email = ? AND employee_id != ? LIMIT 1",
      [email.trim(), req.params.id]
    );
    if (taken.length > 0) {
      throw new AppError("Another account already uses this email.", 409, "EMAIL_TAKEN");
    }
    await pool.query("UPDATE users SET email = ? WHERE employee_id = ?", [email.trim(), req.params.id]);
    await pool.query("UPDATE employees SET email = ? WHERE id = ?", [email.trim(), req.params.id]);
  }

  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password_hash = ? WHERE employee_id = ?", [
      passwordHash,
      req.params.id,
    ]);
  }

  res.json({ success: true });
});

module.exports = {
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  updateEmployeeCredentials,
};