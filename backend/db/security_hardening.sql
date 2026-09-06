-- Row Level Security hardening.
--
-- Run this (after pickups_schema.sql, profiles_schema.sql, and
-- rider_tracking_schema.sql) in the Supabase SQL editor. It cannot be applied from this repo/sandbox: there is
-- no direct Postgres connection string here, only the REST URL + API keys,
-- and this is a live project so it should be reviewed before running anyway.
--
-- The backend (backend/db/supabase.py) authenticates with the Supabase
-- *secret* key, which bypasses RLS entirely - all policies below only
-- constrain the anon/authenticated roles used directly by the browser.
--
-- Each block below is guarded with a to_regclass() existence check and run
-- via EXECUTE, so this file is safe to run as a whole even if some of these
-- tables don't exist yet in this project (e.g. `profiles` was referenced by
-- the frontend but was never actually created here) - it silently skips
-- whatever isn't there instead of erroring out partway through. The report
-- at the bottom tells you what it found.

-- ---------- pickups: users see and manage only their own rows ----------
DO $$
BEGIN
  IF to_regclass('public.pickups') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE pickups ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS pickups_select_own ON pickups';
    EXECUTE 'CREATE POLICY pickups_select_own ON pickups FOR SELECT USING (auth.uid() = user_id)';

    EXECUTE 'DROP POLICY IF EXISTS pickups_insert_own ON pickups';
    EXECUTE 'CREATE POLICY pickups_insert_own ON pickups FOR INSERT WITH CHECK (auth.uid() = user_id)';

    EXECUTE 'DROP POLICY IF EXISTS pickups_update_own ON pickups';
    EXECUTE 'CREATE POLICY pickups_update_own ON pickups FOR UPDATE USING (auth.uid() = user_id)';
    -- In practice all pickups writes go through the backend (service key,
    -- bypasses RLS) - these policies are defense-in-depth in case a client
    -- ever queries this table directly.
  END IF;
END $$;

-- ---------- profiles: users see and edit only their own row ----------
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE profiles ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS profiles_select_own ON profiles';
    EXECUTE 'CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (auth.uid() = id)';

    EXECUTE 'DROP POLICY IF EXISTS profiles_insert_own ON profiles';
    EXECUTE 'CREATE POLICY profiles_insert_own ON profiles FOR INSERT WITH CHECK (auth.uid() = id)';
    -- Defense-in-depth only: profiles_schema.sql's on_auth_user_created
    -- trigger (SECURITY DEFINER, bypasses RLS) is what actually creates rows.

    EXECUTE 'DROP POLICY IF EXISTS profiles_update_own ON profiles';
    EXECUTE 'CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (auth.uid() = id)';
  END IF;
END $$;

-- ---------- users: users see only their own row; backend owns writes ----------
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE users ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS users_select_own ON users';
    EXECUTE 'CREATE POLICY users_select_own ON users FOR SELECT USING (auth.uid() = id)';
    -- No insert/update policy: rows are created/maintained by the backend via
    -- the service key, which bypasses RLS.
  END IF;
END $$;

-- ---------- blogs: public read, no client writes ----------
-- Only backend/blogs.py (service key) writes to this table now - the
-- frontend used to upsert here directly with the anon key, which is what let
-- any visitor plant arbitrary rows. Also remove any existing anon/authenticated
-- write grants in the dashboard (Table Editor > blogs > Policies) if present.
DO $$
BEGIN
  IF to_regclass('public.blogs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE blogs ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS blogs_select_all ON blogs';
    EXECUTE 'CREATE POLICY blogs_select_all ON blogs FOR SELECT USING (true)';
  END IF;
END $$;

-- ---------- rider_locations / rider_locations_latest: backend-only ----------
-- RLS enabled, no policies for anon/authenticated at all - only the backend
-- (service key) touches these directly. Browsers should only ever reach
-- location data via GET /api/pickups/{id}/location (ownership-checked in
-- backend/pickups.py). Add a scoped SELECT policy instead if a live map
-- subscription straight from the browser is wanted later.
DO $$
BEGIN
  IF to_regclass('public.rider_locations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE rider_locations ENABLE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public.rider_locations_latest') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE rider_locations_latest ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ---------- report: which of the expected tables actually exist ----------
SELECT expected_table,
       (to_regclass('public.' || expected_table) IS NOT NULL) AS exists_in_db
FROM unnest(ARRAY[
    'pickups', 'profiles', 'users', 'blogs',
    'rider_locations', 'rider_locations_latest'
]) AS expected_table
ORDER BY exists_in_db, expected_table;
