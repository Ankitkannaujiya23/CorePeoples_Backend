const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const { signToken } = require("../utils/jwt");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

function toSafeUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    organizationId: row.organization_id,
    employeeId: row.employee_id || undefined,
    avatarColor: row.avatar_color,
  };
}

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new AppError("Email and password are required.", 400, "MISSING_FIELDS");
  }

  const [rows] = await pool.execute("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  const user = rows[0];

  if (!user) {
    throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
  }
  // A deactivated employee keeps their historical data but can't sign
  // back in. Admin accounts have no employee_id, so this only applies
  // to employee logins.
  if (user.employee_id) {
    const [empRows] = await pool.execute("SELECT is_active FROM employees WHERE id = ? LIMIT 1", [
      user.employee_id,
    ]);
    if (empRows[0] && !empRows[0].is_active) {
      throw new AppError(
        "Your account has been deactivated. Contact your admin.",
        403,
        "ACCOUNT_DEACTIVATED"
      );
    }
  }

  const safeUser = toSafeUser(user);
  const token = signToken({
    id: safeUser?.id,
    role: safeUser?.role,
    organizationId: safeUser?.organizationId,
    employeeId: safeUser?.employeeId,
  });

  res.json({ user: { ...safeUser, token } });
});

const createOrganization = asyncHandler(async (req, res) => {
  const { organizationName, adminName, email, password, employeeCount, industry } = req.body;

  if (!organizationName || !adminName || !email || !password) {
    throw new AppError("All required fields must be filled in.", 400, "MISSING_FIELDS");
  }

  const [existing] = await pool.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing.length > 0) {
    throw new AppError("An account with this email already exists.", 409, "EMAIL_TAKEN");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const organizationId = randomUUID();
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await conn.query(
      "INSERT INTO organizations (id, name, industry, employee_count, plan) VALUES (?, ?, ?, ?, 'Free Trial')",
      [organizationId, organizationName, industry || null, Number(employeeCount) || 0]
    );

    await conn.query(
      "INSERT INTO users (id, organization_id, employee_id, name, email, password_hash, role, avatar_color) VALUES (?, ?, NULL, ?, ?, ?, 'admin', '#15171C')",
      [userId, organizationId, adminName, email, passwordHash]
    );

    await conn.commit();

    const safeUser = {
      id: userId,
      name: adminName,
      email,
      role: "admin",
      organizationId,
      avatarColor: "#15171C",
    };
    const token = signToken({ id: userId, role: "admin", organizationId });

    res.status(201).json({
      user: safeUser,
      organization: {
        id: organizationId,
        name: organizationName,
        industry: industry || null,
        employeeCount: Number(employeeCount) || 0,
        plan: "Free Trial",
      },
      token,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const logout = asyncHandler(async (req, res) => {
  // JWTs are stateless — logout is a client-side token discard. This
  // endpoint exists so the frontend's authService.logout() has
  // something real to call once MOCK_MODE is off.
  res.json({ success: true });
});

const me = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute("SELECT * FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  const user = rows[0];
  if (!user) throw new AppError("User not found.", 404, "NOT_FOUND");
  res.json({ user: toSafeUser(user) });
});

module.exports = { login, createOrganization, logout, me };
