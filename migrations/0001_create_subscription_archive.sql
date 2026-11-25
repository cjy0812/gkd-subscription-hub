CREATE TABLE IF NOT EXISTS archive_limits (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  max_bytes INTEGER NOT NULL CHECK (max_bytes > 0)
);
INSERT OR IGNORE INTO archive_limits (id, max_bytes) VALUES (1, 536870912);

CREATE TABLE IF NOT EXISTS archive_daily_usage (
  day TEXT PRIMARY KEY,
  r2_reads INTEGER NOT NULL DEFAULT 0 CHECK (r2_reads >= 0),
  r2_writes INTEGER NOT NULL DEFAULT 0 CHECK (r2_writes >= 0)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS archive_objects (
  content_sha256 TEXT PRIMARY KEY CHECK (length(content_sha256) = 64),
  object_key TEXT NOT NULL UNIQUE,
  original_size INTEGER NOT NULL CHECK (original_size >= 0),
  compressed_size INTEGER NOT NULL CHECK (compressed_size >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS enforce_archive_storage_limit
BEFORE INSERT ON archive_objects
WHEN NOT EXISTS (
  SELECT 1 FROM archive_objects WHERE content_sha256 = NEW.content_sha256
)
AND (
  (SELECT COALESCE(SUM(compressed_size), 0) FROM archive_objects) + NEW.compressed_size
    > (SELECT max_bytes FROM archive_limits WHERE id = 1)
  OR (SELECT COUNT(*) FROM archive_objects WHERE date(created_at) = date('now')) >= 200
)
BEGIN
  SELECT RAISE(ABORT, 'R2_ARCHIVE_QUOTA_EXCEEDED');
END;

CREATE TABLE IF NOT EXISTS subscription_versions (
  subscription_id INTEGER NOT NULL CHECK (subscription_id > 0),
  repository_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'unavailable')),
  content_sha256 TEXT,
  object_key TEXT,
  original_size INTEGER,
  compressed_size INTEGER,
  archive_error TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, repository_key, version)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS subscription_versions_by_id
  ON subscription_versions (subscription_id, version DESC);
CREATE INDEX IF NOT EXISTS subscription_versions_by_object
  ON subscription_versions (content_sha256);
