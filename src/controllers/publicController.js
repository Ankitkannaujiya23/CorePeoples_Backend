const { randomUUID } = require("crypto");
const pool = require("../db/pool");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

// No auth on anything in this file — these routes are reached by
// anyone with the link, no login involved.

// Returns just enough for the public form to render: candidates (for
// employee_of_the_month) or questions (for peer_review). No vote
// counts, no other campaigns, nothing beyond this one campaign.
const getPublicCampaign = asyncHandler(async (req, res) => {
    const [linkRows] = await pool.query(
        "SELECT campaign_id FROM campaign_public_links WHERE token = ? LIMIT 1",
        [req.params.token]
    );
    if (!linkRows[0]) throw new AppError("This link isn't valid.", 404, "NOT_FOUND");

    const [campaignRows] = await pool.query(
        "SELECT * FROM campaigns WHERE id = ? AND access_mode = 'public_link' LIMIT 1",
        [linkRows[0].campaign_id]
    );
    const campaign = campaignRows[0];
    if (!campaign) throw new AppError("This link isn't valid.", 404, "NOT_FOUND");

    const base = {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        type: campaign.type,
        status: campaign.status,
        startDate: campaign.start_date,
        endDate: campaign.end_date,
    };

    if (campaign.type === "employee_of_the_month") {
        const [candidateRows] = await pool.query(
            `SELECT e.id, e.name, e.role, e.avatar_color
       FROM campaign_candidates cc
       JOIN employees e ON e.id = cc.employee_id
       WHERE cc.campaign_id = ?`,
            [campaign.id]
        );
        base.candidates = candidateRows.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role,
            avatarColor: r.avatar_color,
        }));
    } else {
        const [questionRows] = await pool.query(
            "SELECT id, label, type FROM campaign_questions WHERE campaign_id = ? ORDER BY sort_order ASC",
            [campaign.id]
        );
        base.questions = questionRows;
    }

    res.json(base);
});

const submitPublicResponse = asyncHandler(async (req, res) => {
    const { employeeId, voterName, targetCandidateId, targetName, answers = [] } = req.body;

    if (!employeeId?.trim() || !voterName?.trim()) {
        throw new AppError("Enter your employee ID and name.", 400, "MISSING_VOTER_INFO");
    }

    const [linkRows] = await pool.query(
        "SELECT campaign_id FROM campaign_public_links WHERE token = ? LIMIT 1",
        [req.params.token]
    );
    if (!linkRows[0]) throw new AppError("This link isn't valid.", 404, "NOT_FOUND");

    const [campaignRows] = await pool.query(
        "SELECT * FROM campaigns WHERE id = ? AND access_mode = 'public_link' LIMIT 1",
        [linkRows[0].campaign_id]
    );
    const campaign = campaignRows[0];
    if (!campaign) throw new AppError("This link isn't valid.", 404, "NOT_FOUND");

    const today = new Date().toISOString().slice(0, 10);
    if (campaign.status !== "active") {
        throw new AppError("This isn't open right now.", 400, "FORM_CLOSED");
    }
    if (today < campaign.start_date) {
        throw new AppError("This hasn't opened yet.", 400, "FORM_NOT_STARTED");
    }
    if (today > campaign.end_date) {
        throw new AppError("This has closed.", 400, "FORM_ENDED");
    }

    let resolvedTargetEmployeeId = null;
    let resolvedTargetName = null;
    let validAnswers = [];

    if (campaign.type === "employee_of_the_month") {
        if (!targetCandidateId) {
            throw new AppError("Choose who you're voting for.", 400, "MISSING_TARGET");
        }
        const [candidateRows] = await pool.query(
            "SELECT e.id, e.name FROM campaign_candidates cc JOIN employees e ON e.id = cc.employee_id WHERE cc.campaign_id = ? AND cc.employee_id = ?",
            [campaign.id, targetCandidateId]
        );
        if (!candidateRows[0]) {
            throw new AppError("That candidate isn't part of this campaign.", 400, "INVALID_TARGET");
        }
        resolvedTargetEmployeeId = candidateRows[0].id;
        resolvedTargetName = candidateRows[0].name;
    } else {
        if (!targetName?.trim()) {
            throw new AppError("Enter the name of the person you're reviewing.", 400, "MISSING_TARGET");
        }
        resolvedTargetName = targetName.trim();

        const [questionRows] = await pool.query(
            "SELECT id FROM campaign_questions WHERE campaign_id = ?",
            [campaign.id]
        );
        const questionIds = new Set(questionRows.map((q) => q.id));

        if (!Array.isArray(answers) || answers.length !== questionRows.length) {
            throw new AppError("Please answer every question.", 400, "INCOMPLETE_ANSWERS");
        }
        for (const a of answers) {
            if (!questionIds.has(a.questionId) || a.value === undefined || a.value === null || a.value === "") {
                throw new AppError("Please answer every question.", 400, "INCOMPLETE_ANSWERS");
            }
        }
        validAnswers = answers;
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const submissionId = randomUUID();
        try {
            await conn.query(
                `INSERT INTO public_submissions
          (id, campaign_id, voter_employee_id, voter_name, target_employee_id, target_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
                [submissionId, campaign.id, employeeId.trim(), voterName.trim(), resolvedTargetEmployeeId, resolvedTargetName]
            );
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new AppError(
                    "This employee ID has already submitted a response for this campaign.",
                    409,
                    "ALREADY_SUBMITTED"
                );
            }
            throw err;
        }

        for (const a of validAnswers) {
            await conn.query(
                "INSERT INTO public_submission_answers (id, submission_id, question_id, answer_value) VALUES (?, ?, ?, ?)",
                [randomUUID(), submissionId, a.questionId, String(a.value)]
            );
        }

        await conn.commit();
        res.status(201).json({ success: true, submittedAt: new Date().toISOString() });
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

module.exports = { getPublicCampaign, submitPublicResponse };