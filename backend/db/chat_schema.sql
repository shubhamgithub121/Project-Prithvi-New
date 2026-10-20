-- chat tables for the Prithvi Assistant (backend/chat.py).
-- All writes go through the backend (service key). Run before
-- security_hardening.sql, which adds the RLS policies.

CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id UUID PRIMARY KEY,
    -- NULL for guest chats; set when a guest signs in mid-chat.
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    -- flow id, model, tools used, token usage
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    feedback TEXT CHECK (feedback IN ('up', 'down')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages(session_id, created_at);

-- Retention: chats are kept 90 days. With the pg_cron extension enabled:
-- SELECT cron.schedule('chat-retention', '0 3 * * *',
--   $$DELETE FROM chat_sessions WHERE updated_at < NOW() - INTERVAL '90 days'$$);
