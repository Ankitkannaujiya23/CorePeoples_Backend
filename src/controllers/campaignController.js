const { randomUUID, randomBytes } = require("crypto");
const pool = require("../db/pool");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

const QUESTION_TYPES = ["rating", "yesno", "text"];

function toCampaignShape(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    votingMode: row.voting_mode,
    resultVisibility: row.result_visibility,
    totalEligibleVoters: row.total_eligible_voters,
    accessMode: row.access_mode || "authenticated",
    publicToken: null, // filled in below for public_link campaigns
    candidateIds: [],
    votes: {},
    voterIds: [],
    questions: [], // only populated for type: 'peer_review'
  };
}

// Attaches candidateIds/votes/voterIds (employee_of_the_month),
// questions (peer_review), and publicToken (access_mode: public_link)
// onto a list of campaign rows.
async function hydrateCampaigns(rows) {
  if (rows.length === 0) return [];
  const campaigns = rows.map(toCampaignShape);
  const byId = Object.fromEntries(campaigns.map((c) => [c.id, c]));
  const ids = campaigns.map((c) => c.id);
  const placeholders = ids.map(() => "?").join(",");

  const [candidateRows] = await pool.query(
    `SELECT campaign_id, employee_id FROM campaign_candidates WHERE campaign_id IN (${placeholders})`,
    ids
  );
  for (const row of candidateRows) {
    byId[row.campaign_id]?.candidateIds.push(row.employee_id);
  }

  const [voteRows] = await pool.query(
    `SELECT campaign_id, candidate_id, voter_id FROM votes WHERE campaign_id IN (${placeholders})`,
    ids
  );
  for (const row of voteRows) {
    const campaign = byId[row.campaign_id];
    if (!campaign) continue;
    campaign.votes[row.candidate_id] = (campaign.votes[row.candidate_id] || 0) + 1;
    campaign.voterIds.push(row.voter_id);
  }

  const [questionRows] = await pool.query(
    `SELECT id, campaign_id, label, type, sort_order FROM campaign_questions
     WHERE campaign_id IN (${placeholders}) ORDER BY sort_order ASC`,
    ids
  );
  for (const row of questionRows) {
    byId[row.campaign_id]?.questions.push({
      id: row.id,
      label: row.label,
      type: row.type,
    });
  }

  const [linkRows] = await pool.query(
    `SELECT campaign_id, token FROM campaign_public_links WHERE campaign_id IN (${placeholders})`,
    ids
  );
  for (const row of linkRows) {
    if (byId[row.campaign_id]) byId[row.campaign_id].publicToken = row.token;
  }

  return campaigns;
}

const getCampaigns = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const query = isAdmin
    ? "SELECT * FROM campaigns WHERE organization_id = ? ORDER BY start_date DESC"
    // Rule: draft campaigns are never visible to employees.
    : "SELECT * FROM campaigns WHERE organization_id = ? AND status != 'draft' ORDER BY start_date DESC";

  const [rows] = await pool.query(query, [req.user.organizationId]);
  res.json(await hydrateCampaigns(rows));
});

const getCampaignById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1",
    [req.params.id, req.user.organizationId]
  );
  if (!rows[0]) throw new AppError("Campaign not found.", 404, "NOT_FOUND");

  if (rows[0].status === "draft" && req.user.role !== "admin") {
    throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  }

  const [hydrated] = await hydrateCampaigns(rows);
  res.json(hydrated);
});

const createCampaign = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    type = "employee_of_the_month",
    candidateIds = [],
    questions = [],
    startDate,
    endDate,
    votingMode = "public",
    resultVisibility = "after_voting_ends",
    accessMode = "authenticated",
    saveAsDraft = false,
  } = req.body;

  if (!name || !name.trim()) {
    throw new AppError("Campaign name is required.", 400, "MISSING_FIELDS");
  }
  if (!startDate || !endDate) {
    throw new AppError("Start and end dates are required.", 400, "MISSING_DATES");
  }
  if (new Date(endDate) < new Date(startDate)) {
    throw new AppError("End date must be after the start date.", 400, "INVALID_DATE_RANGE");
  }
  if (!["authenticated", "public_link"].includes(accessMode)) {
    throw new AppError("Invalid access mode.", 400, "INVALID_ACCESS_MODE");
  }

  const isPeerReview = type === "peer_review";

  if (!isPeerReview && (!Array.isArray(candidateIds) || candidateIds.length === 0)) {
    throw new AppError("Select at least one candidate.", 400, "NO_CANDIDATES");
  }

  if (isPeerReview) {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new AppError("Add at least one question.", 400, "NO_QUESTIONS");
    }
    for (const q of questions) {
      if (!q.label || !q.label.trim()) {
        throw new AppError("Every question needs a label.", 400, "INVALID_QUESTION");
      }
      if (!QUESTION_TYPES.includes(q.type)) {
        throw new AppError("Invalid question type.", 400, "INVALID_QUESTION_TYPE");
      }
    }
  }

  const [eligible] = await pool.query(
    "SELECT COUNT(*) AS count FROM employees WHERE organization_id = ?",
    [req.user.organizationId]
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const campaignId = randomUUID();
    await conn.query(
      `INSERT INTO campaigns
        (id, organization_id, name, description, type, status, start_date, end_date, voting_mode, result_visibility, total_eligible_voters, access_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        campaignId,
        req.user.organizationId,
        name.trim(),
        description || null,
        isPeerReview ? "peer_review" : "employee_of_the_month",
        saveAsDraft ? "draft" : "active",
        startDate,
        endDate,
        votingMode,
        resultVisibility,
        eligible[0].count,
        accessMode,
      ]
    );

    if (isPeerReview) {
      let order = 0;
      for (const q of questions) {
        await conn.query(
          "INSERT INTO campaign_questions (id, campaign_id, label, type, sort_order) VALUES (?, ?, ?, ?, ?)",
          [randomUUID(), campaignId, q.label.trim(), q.type, order]
        );
        order += 1;
      }
    } else {
      for (const employeeId of candidateIds) {
        await conn.query(
          "INSERT INTO campaign_candidates (campaign_id, employee_id) VALUES (?, ?)",
          [campaignId, employeeId]
        );
      }
    }

    if (accessMode === "public_link") {
      const token = randomBytes(16).toString("hex");
      await conn.query(
        "INSERT INTO campaign_public_links (campaign_id, token) VALUES (?, ?)",
        [campaignId, token]
      );
    }

    await conn.commit();

    const [rows] = await pool.query("SELECT * FROM campaigns WHERE id = ?", [campaignId]);
    const [hydrated] = await hydrateCampaigns(rows);
    res.status(201).json(hydrated);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const ALLOWED_STATUSES = ["draft", "active", "paused", "completed"];

const updateCampaignStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new AppError("Invalid status.", 400, "INVALID_STATUS");
  }

  const [rows] = await pool.query(
    "SELECT * FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1",
    [req.params.id, req.user.organizationId]
  );
  if (!rows[0]) throw new AppError("Campaign not found.", 404, "NOT_FOUND");

  // Rule: completed campaigns are read-only.
  if (rows[0].status === "completed") {
    throw new AppError("Completed campaigns can't be changed.", 400, "CAMPAIGN_LOCKED");
  }

  await pool.query("UPDATE campaigns SET status = ? WHERE id = ?", [status, req.params.id]);

  const [updated] = await pool.query("SELECT * FROM campaigns WHERE id = ?", [req.params.id]);
  const [hydrated] = await hydrateCampaigns(updated);
  res.json(hydrated);
});

const deleteCampaign = asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    "DELETE FROM campaigns WHERE id = ? AND organization_id = ?",
    [req.params.id, req.user.organizationId]
  );
  if (result.affectedRows === 0) {
    throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  }
  res.json({ success: true });
});

const duplicateCampaign = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1",
    [req.params.id, req.user.organizationId]
  );
  if (!rows[0]) throw new AppError("Campaign not found.", 404, "NOT_FOUND");

  const [candidateRows] = await pool.query(
    "SELECT employee_id FROM campaign_candidates WHERE campaign_id = ?",
    [req.params.id]
  );
  const [questionRows] = await pool.query(
    "SELECT label, type, sort_order FROM campaign_questions WHERE campaign_id = ? ORDER BY sort_order ASC",
    [req.params.id]
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const newId = randomUUID();
    const source = rows[0];
    await conn.query(
      `INSERT INTO campaigns
        (id, organization_id, name, description, type, status, start_date, end_date, voting_mode, result_visibility, total_eligible_voters, access_mode)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        req.user.organizationId,
        `${source.name} (Copy)`,
        source.description,
        source.type,
        source.start_date,
        source.end_date,
        source.voting_mode,
        source.result_visibility,
        source.total_eligible_voters,
        source.access_mode,
      ]
    );

    for (const row of candidateRows) {
      await conn.query(
        "INSERT INTO campaign_candidates (campaign_id, employee_id) VALUES (?, ?)",
        [newId, row.employee_id]
      );
    }

    for (const row of questionRows) {
      await conn.query(
        "INSERT INTO campaign_questions (id, campaign_id, label, type, sort_order) VALUES (?, ?, ?, ?, ?)",
        [randomUUID(), newId, row.label, row.type, row.sort_order]
      );
    }

    // A duplicated campaign gets its own fresh public link if the
    // source used one — sharing the exact same link for two different
    // campaigns would let one link's submissions leak into the wrong one.
    if (source.access_mode === "public_link") {
      const token = randomBytes(16).toString("hex");
      await conn.query(
        "INSERT INTO campaign_public_links (campaign_id, token) VALUES (?, ?)",
        [newId, token]
      );
    }

    await conn.commit();

    const [created] = await pool.query("SELECT * FROM campaigns WHERE id = ?", [newId]);
    const [hydrated] = await hydrateCampaigns(created);
    res.status(201).json(hydrated);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Admin view of public-link submissions — mirrors reviewController's
// getResponses shape, but reads from public_submissions since those
// voters were never authenticated employees.
const getPublicSubmissions = asyncHandler(async (req, res) => {
  const [campaignRows] = await pool.query(
    "SELECT * FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1",
    [req.params.id, req.user.organizationId]
  );
  const campaign = campaignRows[0];
  if (!campaign || campaign.access_mode !== "public_link") {
    throw new AppError("This campaign has no public submissions.", 404, "NOT_FOUND");
  }

  const [submissionRows] = await pool.query(
    "SELECT * FROM public_submissions WHERE campaign_id = ? ORDER BY created_at DESC",
    [req.params.id]
  );

  if (campaign.type === "employee_of_the_month") {
    const tally = {};
    for (const s of submissionRows) {
      const key = s.target_employee_id || s.target_name;
      if (!tally[key]) {
        tally[key] = { targetEmployeeId: s.target_employee_id, targetName: s.target_name, count: 0 };
      }
      tally[key].count += 1;
    }

    return res.json({
      type: "employee_of_the_month",
      tally: Object.values(tally).sort((a, b) => b.count - a.count),
      submissions: submissionRows.map((s) => ({
        id: s.id,
        voterEmployeeId: s.voter_employee_id,
        voterName: s.voter_name,
        targetName: s.target_name,
        submittedAt: s.created_at,
      })),
    });
  }

  // peer_review: group free-text target names (case/whitespace-insensitive)
  const [questionRows] = await pool.query(
    "SELECT id, label, type FROM campaign_questions WHERE campaign_id = ? ORDER BY sort_order ASC",
    [req.params.id]
  );

  const [answerRows] = await pool.query(
    `SELECT a.submission_id, a.question_id, a.answer_value
     FROM public_submission_answers a
     JOIN public_submissions s ON s.id = a.submission_id
     WHERE s.campaign_id = ?`,
    [req.params.id]
  );
  const answersBySubmission = {};
  for (const a of answerRows) {
    if (!answersBySubmission[a.submission_id]) answersBySubmission[a.submission_id] = [];
    answersBySubmission[a.submission_id].push(a);
  }

  const submissions = submissionRows.map((s) => ({
    id: s.id,
    voterEmployeeId: s.voter_employee_id,
    voterName: s.voter_name,
    targetName: s.target_name,
    submittedAt: s.created_at,
    answers: (answersBySubmission[s.id] || []).map((a) => {
      const q = questionRows.find((q) => q.id === a.question_id);
      return { questionId: a.question_id, label: q?.label, type: q?.type, value: a.answer_value };
    }),
  }));

  const byTarget = {};
  for (const s of submissionRows) {
    const key = s.target_name.trim().toLowerCase();
    if (!byTarget[key]) {
      byTarget[key] = { displayName: s.target_name.trim(), responseCount: 0, answers: [] };
    }
    byTarget[key].responseCount += 1;
    byTarget[key].answers.push(...(answersBySubmission[s.id] || []));
  }

  const summary = Object.values(byTarget).map((entry) => ({
    targetName: entry.displayName,
    responseCount: entry.responseCount,
    questions: questionRows.map((q) => {
      const values = entry.answers.filter((a) => a.question_id === q.id).map((a) => a.answer_value);
      if (q.type === "rating") {
        const nums = values.map(Number).filter((n) => !Number.isNaN(n));
        const average = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        return { questionId: q.id, label: q.label, type: q.type, average: average !== null ? Math.round(average * 10) / 10 : null };
      }
      if (q.type === "yesno") {
        const yesCount = values.filter((v) => v === "yes").length;
        const yesPercentage = values.length ? Math.round((yesCount / values.length) * 100) : null;
        return { questionId: q.id, label: q.label, type: q.type, yesPercentage };
      }
      return { questionId: q.id, label: q.label, type: q.type, comments: values };
    }),
  }));

  res.json({ type: "peer_review", summary, submissions });
});

module.exports = {
  getCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaignStatus,
  deleteCampaign,
  duplicateCampaign,
  getPublicSubmissions,
};