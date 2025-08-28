-- Confidence engine tables
CREATE TABLE IF NOT EXISTS market_now (
  game_id TEXT PRIMARY KEY,
  consensus_spread NUMERIC,
  consensus_total NUMERIC,
  books_covered INT,
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS confidence (
  game_id TEXT PRIMARY KEY,
  pick_side TEXT NOT NULL,      -- 'favorite' | 'underdog'
  pick_team TEXT NOT NULL,
  cover_prob NUMERIC NOT NULL,  -- 0..1
  score NUMERIC NOT NULL,       -- -50..+50
  reasons TEXT NOT NULL,        -- JSON array of bullets
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
