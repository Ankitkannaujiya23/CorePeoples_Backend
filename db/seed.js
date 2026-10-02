// Seeds the database with the exact same demo data the frontend's
// data/*.js fixtures use, so switching MOCK_MODE off feels identical.
//
// Run with: npm run db:seed  (after npm run db:migrate)

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");
const pool = require("../src/db/pool");

const ORG_ID = "org_acme";

const EMPLOYEES = [
  { id: "emp_1", name: "Rahul Sharma", role: "Senior Developer", department: "Engineering", email: "rahul@acme.com", avatarColor: "#B08D3F", blurb: "Always helps the team debug production issues at 2am without complaint." },
  { id: "emp_2", name: "Amit Kumar", role: "Product Designer", department: "Design", email: "amit@acme.com", avatarColor: "#2A2E38", blurb: "Redesigned the onboarding flow and cut drop-off by half this quarter." },
  { id: "emp_3", name: "Priya Singh", role: "Engineering Manager", department: "Engineering", email: "priya@acme.com", avatarColor: "#8F7132", blurb: "Mentored three new hires and kept the team shipping on time." },
  { id: "emp_4", name: "Neha Verma", role: "Customer Success Lead", department: "Support", email: "neha@acme.com", avatarColor: "#565C6D", blurb: "Turned an escalation into our most loyal enterprise account." },
  { id: "emp_5", name: "Karan Singh", role: "Backend Engineer", department: "Engineering", email: "karan@acme.com", avatarColor: "#3C4150", blurb: "Rebuilt the billing pipeline with zero downtime." },
  { id: "emp_6", name: "Anjali Gupta", role: "Marketing Manager", department: "Marketing", email: "anjali@acme.com", avatarColor: "#B33A3A", blurb: "Led the campaign that doubled trial signups in July." },
  { id: "emp_7", name: "Rohan Mehta", role: "Sales Executive", department: "Sales", email: "rohan@acme.com", avatarColor: "#2E7D46", blurb: "Closed our largest deal of the year, ahead of forecast." },
  { id: "emp_8", name: "Simran Kapoor", role: "HR Business Partner", department: "People", email: "simran@acme.com", avatarColor: "#6E5726", blurb: "Redesigned the review cycle so it actually feels fair." },
];

const CAMPAIGNS = [
  {
    id: "camp_aug_2026",
    name: "Employee of the Month — August 2026",
    description: "Recognize the teammate who made the biggest impact across the org this month.",
    status: "active",
    startDate: "2026-08-01",
    endDate: "2026-08-30",
    votingMode: "public",
    resultVisibility: "after_voting_ends",
    candidateIds: ["emp_1", "emp_2", "emp_3", "emp_4", "emp_5", "emp_6"],
    totalEligibleVoters: 8,
    votes: { emp_1: 42, emp_2: 12, emp_3: 31, emp_4: 4, emp_5: 2 },
  },
  {
    id: "camp_jul_2026",
    name: "Employee of the Month — July 2026",
    description: "July's recognition campaign, celebrating consistent impact.",
    status: "completed",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    votingMode: "public",
    resultVisibility: "after_voting_ends",
    candidateIds: ["emp_1", "emp_2", "emp_3", "emp_4", "emp_7", "emp_8"],
    totalEligibleVoters: 8,
    votes: { emp_1: 58, emp_2: 19, emp_3: 23, emp_4: 11, emp_7: 40, emp_8: 33 },
    voters: ["emp_2", "emp_3", "emp_4", "emp_5", "emp_6", "emp_7", "emp_8"],
  },
  {
    id: "camp_jun_2026",
    name: "Employee of the Month — June 2026",
    description: "June's recognition campaign.",
    status: "completed",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    votingMode: "public",
    resultVisibility: "after_voting_ends",
    candidateIds: ["emp_3", "emp_5", "emp_6", "emp_7", "emp_8"],
    totalEligibleVoters: 8,
    votes: { emp_3: 12, emp_5: 61, emp_6: 18, emp_7: 27, emp_8: 9 },
    voters: ["emp_1", "emp_2", "emp_4", "emp_6", "emp_7"],
  },
  {
    id: "camp_best_team_player",
    name: "Best Team Player — Q3 2026",
    description: "A draft campaign recognizing collaboration across teams.",
    status: "draft",
    startDate: "2026-09-01",
    endDate: "2026-09-15",
    votingMode: "anonymous",
    resultVisibility: "admin_only",
    candidateIds: ["emp_2", "emp_4", "emp_6"],
    totalEligibleVoters: 8,
    votes: {},
    voters: [],
  },
];

async function seed() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.query(
      "TRUNCATE TABLE votes; TRUNCATE TABLE campaign_candidates; TRUNCATE TABLE campaigns; TRUNCATE TABLE users; TRUNCATE TABLE employees; TRUNCATE TABLE organizations;"
    );
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");

    await conn.query(
      "INSERT INTO organizations (id, name, industry, employee_count, plan) VALUES (?, ?, ?, ?, ?)",
      [ORG_ID, "Acme Technologies", "Software", 248, "Free Trial"]
    );

    for (const e of EMPLOYEES) {
      await conn.query(
        "INSERT INTO employees (id, organization_id, name, role, department, email, avatar_color, blurb) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [e.id, ORG_ID, e.name, e.role, e.department, e.email, e.avatarColor, e.blurb]
      );
    }

    const adminPasswordHash = await bcrypt.hash("password123", 10);
    await conn.query(
      "INSERT INTO users (id, organization_id, employee_id, name, email, password_hash, role, avatar_color) VALUES (?, ?, NULL, ?, ?, ?, 'admin', ?)",
      ["user_admin", ORG_ID, "Anita Desai", "admin@acme.com", adminPasswordHash, "#15171C"]
    );
    await conn.query(
      "INSERT INTO users (id, organization_id, employee_id, name, email, password_hash, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?, 'employee', ?)",
      ["user_emp_rahul", ORG_ID, "emp_1", "Rahul Sharma", "rahul@acme.com", adminPasswordHash, "#B08D3F"]
    );

    for (const c of CAMPAIGNS) {
      await conn.query(
        `INSERT INTO campaigns
          (id, organization_id, name, description, type, status, start_date, end_date, voting_mode, result_visibility, total_eligible_voters)
         VALUES (?, ?, ?, ?, 'employee_of_the_month', ?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          ORG_ID,
          c.name,
          c.description,
          c.status,
          c.startDate,
          c.endDate,
          c.votingMode,
          c.resultVisibility,
          c.totalEligibleVoters,
        ]
      );

      for (const candidateId of c.candidateIds) {
        await conn.query(
          "INSERT INTO campaign_candidates (campaign_id, employee_id) VALUES (?, ?)",
          [c.id, candidateId]
        );
      }

      // Reconstruct individual vote rows from the aggregate mock counts,
      // distributing them across the employee pool so the
      // UNIQUE(campaign_id, voter_id) constraint is respected.
      const voterPool = EMPLOYEES.map((e) => e.id);
      let voterCursor = 0;
      const usedVoters = new Set();

      for (const [candidateId, count] of Object.entries(c.votes)) {
        for (let i = 0; i < count; i++) {
          let voterId;
          let attempts = 0;
          do {
            voterId = voterPool[voterCursor % voterPool.length];
            voterCursor++;
            attempts++;
          } while (usedVoters.has(voterId) && attempts < voterPool.length * 2);

          if (usedVoters.has(voterId)) continue; // pool exhausted, skip remainder
          usedVoters.add(voterId);

          await conn.query(
            "INSERT INTO votes (id, campaign_id, candidate_id, voter_id) VALUES (?, ?, ?, ?)",
            [randomUUID(), c.id, candidateId, voterId]
          );
        }
      }
    }

    await conn.commit();
    // eslint-disable-next-line no-console
    console.log("✓ Seed complete: 1 organization, 8 employees, 2 users, 4 campaigns.");
  } catch (err) {
    await conn.rollback();
    console.error("Seed failed:", err);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

seed();
