const { randomUUID } = require("crypto");
const pool = require("../db/pool");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

const submitVote = asyncHandler(async (req, res) => {
  const campaignId = req.params.id;
  const { candidateId } = req.body;
  const voterId = req.user.employeeId;

  if (!voterId) {
    throw new AppError("Only employees can vote.", 403, "NOT_AN_EMPLOYEE");
  }
  if (!candidateId) {
    throw new AppError("Select a candidate to vote for.", 400, "MISSING_CANDIDATE");
  }

  const [campaignRows] = await pool.execute(
    "SELECT * FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1",
    [campaignId, req.user.organizationId]
  );
  const campaign = campaignRows[0];
  if (!campaign || campaign.status === "draft") {
    throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  }

  const today = new Date().toISOString().slice(0, 10);
  if (campaign.status !== "active") {
    throw new AppError("Voting is not open for this campaign.", 400, "VOTING_CLOSED");
  }
  if (today < campaign.start_date) {
    throw new AppError("Voting hasn't started yet.", 400, "VOTING_NOT_STARTED");
  }
  if (today > campaign.end_date) {
    throw new AppError("Voting has ended for this campaign.", 400, "VOTING_ENDED");
  }

  const [candidateRows] = await pool.execute(
    "SELECT 1 FROM campaign_candidates WHERE campaign_id = ? AND employee_id = ? LIMIT 1",
    [campaignId, candidateId]
  );
  if (candidateRows.length === 0) {
    throw new AppError("That candidate isn't part of this campaign.", 400, "INVALID_CANDIDATE");
  }

  try {
    await pool.execute(
      "INSERT INTO votes (id, campaign_id, candidate_id, voter_id) VALUES (?, ?, ?, ?)",
      [randomUUID(), campaignId, candidateId, voterId]
    );
  } catch (err) {
    // The UNIQUE(campaign_id, voter_id) constraint is the real guarantee
    // against double voting — this just turns it into a friendly 409.
    if (err.code === "ER_DUP_ENTRY") {
      throw new AppError("You have already voted in this campaign.", 409, "ALREADY_VOTED");
    }
    throw err;
  }

  res.status(201).json({
    success: true,
    campaignId,
    candidateId,
    voterId,
    submittedAt: new Date().toISOString(),
  });
});

// Returns { [campaignId]: candidateId } for the logged-in employee —
// used to hydrate the frontend's votes slice without relying on
// localStorage once the real backend is wired up.
const getMyVotes = asyncHandler(async (req, res) => {
  if (!req.user.employeeId) {
    return res.json({});
  }

  const [rows] = await pool.execute(
    "SELECT campaign_id, candidate_id FROM votes WHERE voter_id = ?",
    [req.user.employeeId]
  );

  const map = {};
  for (const row of rows) {
    map[row.campaign_id] = row.candidate_id;
  }
  res.json(map);
});

module.exports = { submitVote, getMyVotes };
