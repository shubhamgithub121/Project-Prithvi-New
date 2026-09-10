-- profiles table: backs the bio/avatar editor in prithvi-app/src/pages/Profile.jsx.
-- (Note this is a different table from `users`, which is what
-- backend/auth.py's get_profile() reads for GET /api/auth/me - `users` holds
-- the account record, `profiles` holds the editable public-facing bits.)
--
-- Run this before security_hardening.sql (which adds RLS policies for it).

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    avatar TEXT,
    bio TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create a profile row whenever a new auth user is created - this covers
-- both signup paths: POST /api/auth/register (backend -> supabase auth.sign_up)
-- and "Sign in with Google" (goes straight through Supabase Auth, never
-- touching the FastAPI backend at all), so neither path can skip it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, name, avatar, bio)
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name',
            split_part(NEW.email, '@', 1)
        ),
        NEW.raw_user_meta_data->>'avatar_url',
        ''
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: give every already-existing auth user a profile row too, so
-- accounts created before this migration aren't left without one.
INSERT INTO public.profiles (id, name, avatar, bio)
SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
    u.raw_user_meta_data->>'avatar_url',
    ''
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
