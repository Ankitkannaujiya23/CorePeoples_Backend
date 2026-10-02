-- Office Manager schema
-- Run with: mysql -u root -p < db/schema.sql
-- (or `npm run db:migrate`, which runs this file via the app's own connection)

CREATE DATABASE IF NOT EXISTS office_manager
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE office_manager;

CREATE TABLE IF NOT EXISTS organizations (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  industry      VARCHAR(80),
  employee_count INT DEFAULT 0,
  plan          VARCHAR(40) DEFAULT 'Free Trial',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employees (
  id              VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  name            VARCHAR(150) NOT NULL,
  role            VARCHAR(120),
  department      VARCHAR(80),
  email           VARCHAR(150) NOT NULL,
  avatar_color    VARCHAR(20) DEFAULT '#2A2E38',
  blurb           TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE KEY uq_employee_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id              VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  employee_id     VARCHAR(36) NULL,
  name            VARCHAR(150) NOT NULL,
  email           VARCHAR(150) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('admin', 'employee') NOT NULL,
  avatar_color    VARCHAR(20) DEFAULT '#15171C',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  UNIQUE KEY uq_user_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaigns (
  id                    VARCHAR(36) PRIMARY KEY,
  organization_id       VARCHAR(36) NOT NULL,
  name                  VARCHAR(200) NOT NULL,
  description           TEXT,
  type                  VARCHAR(60) DEFAULT 'employee_of_the_month',
  status                ENUM('draft', 'active', 'paused', 'completed') DEFAULT 'draft',
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  voting_mode           ENUM('public', 'anonymous') DEFAULT 'public',
  result_visibility     ENUM('after_voting_ends', 'admin_only') DEFAULT 'after_voting_ends',
  total_eligible_voters INT DEFAULT 0,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CHECK (end_date >= start_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaign_candidates (
  campaign_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (campaign_id, employee_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One row per vote. UNIQUE(campaign_id, voter_id) is what enforces
-- "one employee can vote once per campaign" at the database level.
CREATE TABLE IF NOT EXISTS votes (
  id           VARCHAR(36) PRIMARY KEY,
  campaign_id  VARCHAR(36) NOT NULL,
  candidate_id VARCHAR(36) NOT NULL,
  voter_id     VARCHAR(36) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (voter_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_one_vote_per_campaign (campaign_id, voter_id)
) ENGINE=InnoDB;

CREATE INDEX idx_campaigns_org_status ON campaigns (organization_id, status);
CREATE INDEX idx_employees_org ON employees (organization_id);
CREATE INDEX idx_votes_campaign ON votes (campaign_id);
