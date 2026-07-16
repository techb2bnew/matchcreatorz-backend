-- MatchCreatorz performance indexes
-- Run once: psql -h <host> -U postgres -d matchcreatorz -f add_indexes.sql

-- bookings table (most queried)
CREATE INDEX IF NOT EXISTS idx_bookings_seller_id     ON bookings(seller_id);
CREATE INDEX IF NOT EXISTS idx_bookings_buyer_id      ON bookings(buyer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status        ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at    ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_seller_status ON bookings(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_buyer_status  ON bookings(buyer_id, status);

-- services table
CREATE INDEX IF NOT EXISTS idx_services_seller_id ON services(seller_id);

-- bids table
CREATE INDEX IF NOT EXISTS idx_bids_seller_id     ON bids(seller_id);
CREATE INDEX IF NOT EXISTS idx_bids_seller_status ON bids(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_bids_job_id        ON bids(job_id);

-- reviews table
CREATE INDEX IF NOT EXISTS idx_reviews_seller_id ON reviews(seller_id);

-- jobs table
CREATE INDEX IF NOT EXISTS idx_jobs_buyer_id     ON jobs(buyer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status       ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_buyer_status ON jobs(buyer_id, status);

-- users table
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

SELECT 'Done! All indexes created.' AS result;
