-- rider_locations table (history)
CREATE TABLE IF NOT EXISTS rider_locations (
    id UUID PRIMARY KEY,
    rider_id TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rider_locations_rider_id ON rider_locations(rider_id);

-- rider_locations_latest table (current location for realtime)
CREATE TABLE IF NOT EXISTS rider_locations_latest (
    rider_id TEXT PRIMARY KEY,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable realtime for the latest table
ALTER PUBLICATION supabase_realtime ADD TABLE rider_locations_latest;
