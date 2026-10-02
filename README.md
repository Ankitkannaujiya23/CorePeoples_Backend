# VoteDesk API

Node.js + Express + MySQL backend for VoteDesk, built to match the
frontend's mock `services/*` layer field-for-field — so switching
`MOCK_MODE` off on the frontend is a small, mechanical change.

## Setup

```bash
npm install
cp .env.example .env      # edit DB_USER / DB_PASSWORD / JWT_SECRET as needed
npm run db:migrate        # creates the `votedesk` database + tables
npm run db:seed           # loads the same demo data the frontend mocks use
npm run dev                # starts on http://localhost:4000
```

Requires a local MySQL server reachable with the credentials in `.env`
(defaults assume `root` with no password on `127.0.0.1:3306` — update
`.env` to match your setup).

## Demo accounts (after seeding)

| Role     | Email             | Password    |
|----------|-------------------|-------------|
| Admin    | admin@acme.com    | password123 |
| Employee | rahul@acme.com    | password123 |

## Auth

JWT, sent as `Authorization: Bearer <token>`. `POST /api/auth/login` and
`POST /api/auth/signup` return `{ user, token }` (signup also returns
`organization`). Every other route requires the header.

## Endpoints

| Method | Path                          | Access         | Notes |
|--------|-------------------------------|----------------|-------|
| POST   | `/api/auth/login`             | public         | |
| POST   | `/api/auth/signup`            | public         | creates org + admin |
| POST   | `/api/auth/logout`            | authenticated  | stateless, just for symmetry |
| GET    | `/api/auth/me`                | authenticated  | rehydrate session on refresh |
| GET    | `/api/organizations/me`       | authenticated  | |
| PATCH  | `/api/organizations/me`       | admin          | |
| GET    | `/api/employees`              | authenticated  | |
| GET    | `/api/employees/:id`          | authenticated  | |
| GET    | `/api/campaigns`              | authenticated  | drafts hidden from employees |
| GET    | `/api/campaigns/:id`          | authenticated  | |
| POST   | `/api/campaigns`              | admin          | body matches `CampaignForm` payload |
| PATCH  | `/api/campaigns/:id`          | admin          | body `{ status }`; blocked once completed |
| DELETE | `/api/campaigns/:id`          | admin          | |
| POST   | `/api/campaigns/:id/duplicate`| admin          | copies as a new draft |
| POST   | `/api/campaigns/:id/vote`     | employee       | body `{ candidateId }` |
| GET    | `/api/votes/me`               | authenticated  | `{ campaignId: candidateId }` |

Campaign objects are returned in exactly the shape
`frontend/data/campaigns.js` uses: `candidateIds`, `votes` (an
aggregate `{ candidateId: count }` map), and `voterIds`.

## Product rules enforced server-side

- **One vote per employee per campaign** — a `UNIQUE(campaign_id, voter_id)`
  constraint on the `votes` table, not just a UI check. A repeat attempt
  gets a `409 ALREADY_VOTED`.
- **No voting outside the window** — `submitVote` checks the campaign is
  `active` and today's date is within `start_date`/`end_date`.
- **Draft campaigns are invisible to employees** — filtered out of both
  the list and detail queries for non-admin roles.
- **Completed campaigns are read-only** — `PATCH /campaigns/:id` refuses
  once `status = 'completed'`.
- **A campaign needs ≥1 candidate and end date ≥ start date** — validated
  in `createCampaign`, backed by a `CHECK` constraint in the schema.

## Wiring up the frontend

The frontend's `lib/api.js` already has a `MOCK_MODE` flag and an Axios-
style client waiting for this. Two changes on the frontend side:

1. In `votedesk/lib/api.js`, set `MOCK_MODE = false` and point
   `NEXT_PUBLIC_API_BASE_URL` at `http://localhost:4000/api` (add that to
   a `.env.local` in the frontend project).
2. In each `services/*.js` file, swap the local-fixture calls for
   `api.get/post/patch/delete`, and store the returned `token` (e.g. in
   `localStorage` alongside the user) so `lib/api.js` can attach it as
   `Authorization: Bearer <token>` on every request.

Everything downstream — Redux slices, components, pages — stays exactly
as it is, since the response shapes already match.

## Project structure

```
db/               schema.sql, migrate.js, seed.js
src/
  app.js          Express app + route mounting
  server.js       entry point
  config/         (reserved for future env/config helpers)
  db/pool.js      mysql2 connection pool
  middleware/      auth.js (JWT + role guard), errorHandler.js
  routes/          one file per resource
  controllers/     one file per resource
  utils/           AppError, asyncHandler, jwt helpers
```
