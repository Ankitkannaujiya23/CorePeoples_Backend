const { randomUUID } = require("crypto");
const pool = require("../db/pool");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

// Employee fills out the form for one colleague — one submission per
// employee per campaign (UNIQUE(campaign_id, voter_id) enforces it).
const submitResponse = asyncHandler(async (req, res) => {
    const campaignId = req.params.id;
    const { targetEmployeeId, answers = [] } = req.body;
    const voterId = req.user.employeeId;

    if (!voterId) {
        throw new AppError("Only employees can submit this form.", 403, "NOT_AN_EMPLOYEE");
    }
    if (!targetEmployeeId) {
        throw new AppError("Choose a teammate to review.", 400, "MISSING_TARGET");
    }
    if (targetEmployeeId === voterId) {
        throw new AppError("You can't review yourself.", 400, "CANNOT_REVIEW_SELF");
    }

    const [campaignRows] = await pool.query(
        "SELECT * FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1",
        [campaignId, req.user.organizationId]
    );
    const campaign = campaignRows[0];
    if (!campaign || campaign.type !== "peer_review") {
        throw new AppError("Campaign not found.", 404, "NOT_FOUND");
    }

    const today = new Date().toISOString().slice(0, 10);
    if (campaign.status !== "active") {
        throw new AppError("This form is not open right now.", 400, "FORM_CLOSED");
    }
    if (today < campaign.start_date) {
        throw new AppError("This form hasn't opened yet.", 400, "FORM_NOT_STARTED");
    }
    if (today > campaign.end_date) {
        throw new AppError("This form has closed.", 400, "FORM_ENDED");
    }

    const [targetRows] = await pool.query(
        "SELECT id FROM employees WHERE id = ? AND organization_id = ? LIMIT 1",
        [targetEmployeeId, req.user.organizationId]
    );
    if (!targetRows[0]) {
        throw new AppError("That teammate wasn't found.", 400, "INVALID_TARGET");
    }

    const [questionRows] = await pool.query(
        "SELECT id, type FROM campaign_questions WHERE campaign_id = ?",
        [campaignId]
    );
    const questionIds = new Set(questionRows.map((q) => q.id));

    if (!Array.isArray(answers) || answers.length !== questionRows.length) {
        throw new AppError("Please answer every question.", 400, "INCOMPLETE_ANSWERS");
    }


    for (const a of answers) {
        // answerId = a?.questionId + "";
        // if (!questionIds.has(answerId) || a.value === undefined || a.value === null || a.value === "") {
        //     throw new AppError("Please answer every question.", 400, "INCOMPLETE_ANSWERS");
        // }

        const answerId = String(a?.questionId);

        const questionIdInvalid = !questionIds.has(answerId);
        const valueUndefined = a.value === undefined;
        const valueNull = a.value === null;
        const valueEmpty = a.value === "";

        console.log({
            answerId,
            questionIds: [...questionIds],
            questionIdInvalid,
            valueUndefined,
            valueNull,
            valueEmpty,
            value: a.value
        });

        if (
            questionIdInvalid ||
            valueUndefined ||
            valueNull ||
            valueEmpty
        ) {
            throw new AppError(
                "Please answer every question.",
                400,
                "INCOMPLETE_ANSWERS"
            );
        }

    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const responseId = randomUUID();
        try {
            await conn.query(
                "INSERT INTO campaign_responses (id, campaign_id, voter_id, target_employee_id) VALUES (?, ?, ?, ?)",
                [responseId, campaignId, voterId, targetEmployeeId]
            );
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new AppError(
                    "You have already submitted this form.",
                    409,
                    "ALREADY_SUBMITTED"
                );
            }
            throw err;
        }

        for (const a of answers) {
            await conn.query(
                "INSERT INTO campaign_response_answers (id, response_id, question_id, answer_value) VALUES (?, ?, ?, ?)",
                [randomUUID(), responseId, a.questionId, String(a.value)]
            );
        }

        await conn.commit();

        res.status(201).json({
            success: true,
            campaignId,
            targetEmployeeId,
            submittedAt: new Date().toISOString(),
        });
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

// Lets the frontend check "have I already filled this out" without
// guessing from client-side state.
const getMyResponse = asyncHandler(async (req, res) => {
    if (!req.user.employeeId) {
        return res.json({ submitted: false });
    }

    const [rows] = await pool.query(
        "SELECT target_employee_id FROM campaign_responses WHERE campaign_id = ? AND voter_id = ? LIMIT 1",
        [req.params.id, req.user.employeeId]
    );

    if (!rows[0]) return res.json({ submitted: false });
    res.json({ submitted: true, targetEmployeeId: rows[0].target_employee_id });
});

// Admin view: a per-employee summary (rating averages, yes/no split)
// plus the raw list of individual responses.
const getResponses = asyncHandler(async (req, res) => {
    const [campaignRows] = await pool.query(
        "SELECT * FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1",
        [req.params.id, req.user.organizationId]
    );
    const campaign = campaignRows[0];
    if (!campaign || campaign.type !== "peer_review") {
        throw new AppError("Campaign not found.", 404, "NOT_FOUND");
    }
    const isAnonymous = campaign.voting_mode === "anonymous";

    const [questionRows] = await pool.query(
        "SELECT id, label, type FROM campaign_questions WHERE campaign_id = ? ORDER BY sort_order ASC",
        [req.params.id]
    );

    const [responseRows] = await pool.query(
        `SELECT r.id AS response_id, r.voter_id, r.target_employee_id, r.created_at,
            voter.name AS voter_name, target.name AS target_name, target.avatar_color AS target_avatar_color
     FROM campaign_responses r
     JOIN employees voter ON voter.id = r.voter_id
     JOIN employees target ON target.id = r.target_employee_id
     WHERE r.campaign_id = ?
     ORDER BY r.created_at DESC`,
        [req.params.id]
    );

    const [answerRows] = await pool.query(
        `SELECT a.response_id, a.question_id, a.answer_value
     FROM campaign_response_answers a
     JOIN campaign_responses r ON r.id = a.response_id
     WHERE r.campaign_id = ?`,
        [req.params.id]
    );

    const answersByResponse = {};
    for (const a of answerRows) {
        if (!answersByResponse[a.response_id]) answersByResponse[a.response_id] = [];
        answersByResponse[a.response_id].push(a);
    }

    // Raw responses, newest first.
    const responses = responseRows.map((r) => ({
        id: r.response_id,
        voterName: isAnonymous ? "Anonymous" : r.voter_name,
        targetEmployeeId: r.target_employee_id,
        targetName: r.target_name,
        submittedAt: r.created_at,
        answers: (answersByResponse[r.response_id] || []).map((a) => {
            const q = questionRows.find((q) => q.id === a.question_id);
            return { questionId: a.question_id, label: q?.label, type: q?.type, value: a.answer_value };
        }),
    }));

    // Per-target-employee summary.
    const byTarget = {};
    for (const r of responseRows) {
        if (!byTarget[r.target_employee_id]) {
            byTarget[r.target_employee_id] = {
                employeeId: r.target_employee_id,
                employeeName: r.target_name,
                avatarColor: r.target_avatar_color,
                responseCount: 0,
                answers: [],
            };
        }
        byTarget[r.target_employee_id].responseCount += 1;
        byTarget[r.target_employee_id].answers.push(...(answersByResponse[r.response_id] || []));
    }

    const summary = Object.values(byTarget).map((entry) => {
        const questionSummaries = questionRows.map((q) => {
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
        });

        return {
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            avatarColor: entry.avatarColor,
            responseCount: entry.responseCount,
            questions: questionSummaries,
        };
    });

    res.json({ questions: questionRows, summary, responses });
});

module.exports = { submitResponse, getMyResponse, getResponses };