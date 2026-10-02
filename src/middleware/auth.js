const { verifyToken } = require("../utils/jwt");
const AppError = require("../utils/AppError");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return next(new AppError("Not authenticated.", 401, "NO_TOKEN"));
  }

  try {
    const payload = verifyToken(token);
    req.user = payload; // { id, role, organizationId, employeeId }
    next();
  } catch (err) {
    next(new AppError("Invalid or expired session.", 401, "INVALID_TOKEN"));
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError("You don't have access to this resource.", 403, "FORBIDDEN"));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
