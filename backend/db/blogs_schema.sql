-- blogs: dev.to articles synced by backend/blogs.py, read by the landing page (Home.jsx).
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS blogs (
    id BIGINT PRIMARY KEY,              -- dev.to article id, so upserts dedupe
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    image TEXT,
    excerpt TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blogs_created_at ON blogs(created_at DESC);

-- Public read; only the backend (service key, bypasses RLS) writes.
ALTER TABLE blogs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blogs_select_all ON blogs;
CREATE POLICY blogs_select_all ON blogs FOR SELECT USING (true);

-- Realtime INSERT/UPDATE events for the landing page feed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'blogs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE blogs;
  END IF;
END $$;
