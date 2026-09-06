-- pickups table: real, persisted pickup requests.
-- rider_id is always server-generated (backend/pickups.py) and is a dummy id
-- until a real rider app exists - it is never accepted from a client.
CREATE TABLE IF NOT EXISTS pickups (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rider_id TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    pincode TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    pickup_date DATE NOT NULL,
    time_slot TEXT NOT NULL,
    plastic_type TEXT,
    estimated_weight_kg DOUBLE PRECISION NOT NULL,
    estimated_earnings DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pickups_user_id ON pickups(user_id);
CREATE INDEX IF NOT EXISTS idx_pickups_rider_id ON pickups(rider_id);
