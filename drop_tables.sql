-- Run this in pgAdmin Query Tool to reset all tables
DROP TABLE IF EXISTS seller_profiles CASCADE;
DROP TABLE IF EXISTS buyer_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Also drop ENUMs if they exist
DROP TYPE IF EXISTS enum_users_role CASCADE;
DROP TYPE IF EXISTS enum_users_status CASCADE;
