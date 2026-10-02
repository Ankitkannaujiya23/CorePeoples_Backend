const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const authRoutes = require("./routes/authRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const campaignRoutes = require("./routes/campaignRoutes");
const voteRoutes = require("./routes/voteRoutes");
const publicRoutes = require("./routes/publicRoutes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/votes", voteRoutes);
// No requireAuth anywhere in this router — reachable by anyone with a link.
app.use("/api/public", publicRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;