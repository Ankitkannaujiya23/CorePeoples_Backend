const AppError = require("../utils/AppError");

function notFoundHandler(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, "NOT_FOUND"));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;

  if (!isAppError) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(statusCode).json({
    message: isAppError ? err.message : "Something went wrong on our end.",
    code: isAppError ? err.code : "INTERNAL_ERROR",
  });
}

module.exports = { notFoundHandler, errorHandler };
