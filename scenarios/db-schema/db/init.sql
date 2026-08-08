-- Schema v16: This is the OUTDATED schema.
-- Missing the `subscription` column that was added in v17.
-- The application expects v17, which causes:
--   "column "subscription" does not exist"

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL
);

-- Seed some test data
INSERT INTO users (id, email, name) VALUES
  ('usr_001', 'alice@example.com', 'Alice Johnson'),
  ('usr_002', 'bob@example.com', 'Bob Smith');
