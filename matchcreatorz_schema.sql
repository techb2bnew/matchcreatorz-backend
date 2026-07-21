-- ============================================================
-- MatchCreatorz — PostgreSQL schema + seed data
-- Generated from Sequelize models. Target: PostgreSQL 13+
-- ============================================================

BEGIN;

-- ---------- ENUM TYPES ----------
DO $$ BEGIN
  CREATE TYPE "public"."enum_users_role" AS ENUM ('ADMIN', 'SELLER', 'BUYER');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_users_status" AS ENUM ('active', 'inactive', 'banned');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_seller_profiles_approval_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_services_status" AS ENUM ('active', 'paused', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_jobs_job_type" AS ENUM ('fixed', 'hourly');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_jobs_experience_level" AS ENUM ('any', 'beginner', 'intermediate', 'expert');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_jobs_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_bids_status" AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_bookings_status" AS ENUM ('pending', 'ongoing', 'amidst_completion', 'completed', 'cancelled', 'in_dispute');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_reviews_status" AS ENUM ('published', 'hidden');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_connect_transactions_type" AS ENUM ('admin_credit', 'bid_deduct', 'purchase', 'refund');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."enum_offers_status" AS ENUM ('pending', 'accepted', 'declined', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------- TABLES ----------

-- User
CREATE TABLE IF NOT EXISTS "users" ("id"  SERIAL , "name" VARCHAR(100) NOT NULL, "email" VARCHAR(150) NOT NULL UNIQUE, "password" VARCHAR(255) NOT NULL, "phone" VARCHAR(20), "role" "public"."enum_users_role" NOT NULL DEFAULT 'BUYER', "status" "public"."enum_users_status" NOT NULL DEFAULT 'active', "is_verified" BOOLEAN DEFAULT false, "otp" VARCHAR(6), "otp_expiry" TIMESTAMP WITH TIME ZONE, "phone_otp" VARCHAR(6), "phone_otp_expiry" TIMESTAMP WITH TIME ZONE, "is_phone_verified" BOOLEAN DEFAULT false, "bio" TEXT, "location" VARCHAR(150), "avatar" VARCHAR(500), "reset_token" VARCHAR(255), "reset_token_expiry" TIMESTAMP WITH TIME ZONE, "web_fcm_token" TEXT, "mobile_fcm_token" TEXT, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, PRIMARY KEY ("id"));

-- SellerProfile
CREATE TABLE IF NOT EXISTS "seller_profiles" ("id"  SERIAL , "user_id" INTEGER NOT NULL UNIQUE REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "bio" TEXT, "skills" VARCHAR(255)[] DEFAULT ARRAY[]::VARCHAR(255)[], "hourly_rate" DECIMAL(10,2) DEFAULT 0, "connects_balance" INTEGER NOT NULL DEFAULT 0, "rating" DECIMAL(3,2) DEFAULT 0, "total_reviews" INTEGER DEFAULT 0, "city" VARCHAR(100), "country" VARCHAR(100), "profile_image" VARCHAR(255), "resume" TEXT, "portfolio_files" TEXT[] DEFAULT ARRAY[]::TEXT[], "portfolio_links" TEXT[] DEFAULT ARRAY[]::TEXT[], "is_available" BOOLEAN DEFAULT true, "approval_status" "public"."enum_seller_profiles_approval_status" NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, PRIMARY KEY ("id"));

-- BuyerProfile
CREATE TABLE IF NOT EXISTS "buyer_profiles" ("id"  SERIAL , "user_id" INTEGER NOT NULL UNIQUE REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "company_name" VARCHAR(150), "city" VARCHAR(100), "country" VARCHAR(100), "profile_image" VARCHAR(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, PRIMARY KEY ("id"));

-- Category
CREATE TABLE IF NOT EXISTS "categories" ("id"  SERIAL , "name" VARCHAR(100) NOT NULL UNIQUE, "icon" TEXT, "description" TEXT, "services_count" INTEGER DEFAULT 0, "sellers_count" INTEGER DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, PRIMARY KEY ("id"));

-- Service
CREATE TABLE IF NOT EXISTS "services" ("id"  SERIAL , "seller_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "category_id" INTEGER REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE, "title" VARCHAR(200) NOT NULL, "description" TEXT, "price" DECIMAL(10,2) NOT NULL DEFAULT 0, "delivery_days" INTEGER NOT NULL DEFAULT 1, "revisions" INTEGER NOT NULL DEFAULT 1, "images" JSONB DEFAULT '[]', "tags" JSONB DEFAULT '[]', "category_ids" JSONB DEFAULT '[]', "status" "public"."enum_services_status" NOT NULL DEFAULT 'active', "is_featured" BOOLEAN DEFAULT false, "views_count" INTEGER DEFAULT 0, "orders_count" INTEGER DEFAULT 0, "rating" DECIMAL(3,2) DEFAULT 0, "reviews_count" INTEGER DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, PRIMARY KEY ("id"));

-- Job
CREATE TABLE IF NOT EXISTS "jobs" ("id"  SERIAL , "buyer_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "title" VARCHAR(200) NOT NULL, "description" TEXT, "category" VARCHAR(100) NOT NULL DEFAULT 'General', "job_type" "public"."enum_jobs_job_type" NOT NULL DEFAULT 'fixed', "budget_min" DECIMAL(10,2), "budget_max" DECIMAL(10,2), "deadline" DATE, "skills" JSON DEFAULT '[]', "experience_level" "public"."enum_jobs_experience_level" NOT NULL DEFAULT 'any', "status" "public"."enum_jobs_status" NOT NULL DEFAULT 'OPEN', "bids_count" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, PRIMARY KEY ("id"));

-- Bid
CREATE TABLE IF NOT EXISTS "bids" ("id"  SERIAL , "job_id" INTEGER NOT NULL REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "seller_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "amount" DECIMAL(10,2) NOT NULL, "delivery_days" INTEGER NOT NULL, "proposal" TEXT, "status" "public"."enum_bids_status" NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, PRIMARY KEY ("id"));

-- Booking
CREATE TABLE IF NOT EXISTS "bookings" ("id"  SERIAL , "buyer_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "seller_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "service_id" INTEGER REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE, "job_id" INTEGER REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE, "title" VARCHAR(200) NOT NULL, "amount" DECIMAL(10,2) NOT NULL, "platform_fee" DECIMAL(10,2) NOT NULL DEFAULT 0, "status" "public"."enum_bookings_status" NOT NULL DEFAULT 'pending', "notes" TEXT, "cancel_reason" TEXT, "dispute_reason" TEXT, "delivery_days" INTEGER, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, PRIMARY KEY ("id"));

-- Review
CREATE TABLE IF NOT EXISTS "reviews" ("id"  SERIAL , "buyer_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "seller_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "service_id" INTEGER REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE, "booking_id" INTEGER NOT NULL REFERENCES "bookings" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "rating" INTEGER NOT NULL, "comment" TEXT, "status" "public"."enum_reviews_status" NOT NULL DEFAULT 'published', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, PRIMARY KEY ("id"));

-- Notification
CREATE TABLE IF NOT EXISTS "notifications" ("id"  SERIAL , "user_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "title" VARCHAR(255) NOT NULL, "body" TEXT, "type" VARCHAR(100), "data" JSONB DEFAULT '{}', "is_read" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, PRIMARY KEY ("id"));

-- Favourite
CREATE TABLE IF NOT EXISTS "favourites" ("id"  SERIAL , "user_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "service_id" INTEGER NOT NULL REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, PRIMARY KEY ("id"));

-- ConnectTransaction
CREATE TABLE IF NOT EXISTS "connect_transactions" ("id"  SERIAL , "seller_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "amount" INTEGER NOT NULL, "balance_after" INTEGER NOT NULL DEFAULT 0, "type" "public"."enum_connect_transactions_type" NOT NULL DEFAULT 'admin_credit', "note" VARCHAR(255), "ref_id" INTEGER, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, PRIMARY KEY ("id"));

-- Offer
CREATE TABLE IF NOT EXISTS "offers" ("id"  SERIAL , "seller_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "buyer_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE, "service_id" INTEGER REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE, "title" VARCHAR(200) NOT NULL, "description" TEXT, "amount" DECIMAL(10,2) NOT NULL, "delivery_days" INTEGER, "status" "public"."enum_offers_status" NOT NULL DEFAULT 'pending', "booking_id" INTEGER REFERENCES "bookings" ("id") ON DELETE SET NULL ON UPDATE CASCADE, "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, PRIMARY KEY ("id"));

-- ---------- INDEXES ----------
CREATE UNIQUE INDEX IF NOT EXISTS "favourites_user_id_service_id" ON "favourites" ("user_id", "service_id");
CREATE INDEX IF NOT EXISTS "services_seller_id" ON "services" ("seller_id");
CREATE INDEX IF NOT EXISTS "services_category_id" ON "services" ("category_id");
CREATE INDEX IF NOT EXISTS "services_status" ON "services" ("status");
CREATE INDEX IF NOT EXISTS "jobs_status" ON "jobs" ("status");
CREATE INDEX IF NOT EXISTS "bids_job_id" ON "bids" ("job_id");
CREATE INDEX IF NOT EXISTS "bookings_buyer_id" ON "bookings" ("buyer_id");
CREATE INDEX IF NOT EXISTS "bookings_seller_id" ON "bookings" ("seller_id");
CREATE INDEX IF NOT EXISTS "reviews_seller_id" ON "reviews" ("seller_id");
CREATE INDEX IF NOT EXISTS "notifications_user_id" ON "notifications" ("user_id");
CREATE INDEX IF NOT EXISTS "offers_buyer_id" ON "offers" ("buyer_id");
CREATE INDEX IF NOT EXISTS "offers_seller_id" ON "offers" ("seller_id");
CREATE INDEX IF NOT EXISTS "connect_transactions_seller_id" ON "connect_transactions" ("seller_id");

-- ---------- SEED DATA ----------
-- Default admin (email: admin@matchcreatorz.com  password: Admin@123)
INSERT INTO "users" ("name","email","password","role","status","is_verified","created_at","updated_at")
VALUES ('Super Admin','admin@matchcreatorz.com','$2a$12$moIpxH1/4sBgKSOB7FR.qOh3JwOyDtqX/DCim.Lf1o87/TcZOCUou','ADMIN','active',true,NOW(),NOW())
ON CONFLICT ("email") DO NOTHING;

-- Starter categories
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Web Development','fa-code',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Graphic Design','fa-paint-brush',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Digital Marketing','fa-bullhorn',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Writing & Translation','fa-pen',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Video & Animation','fa-video',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Music & Audio','fa-music',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Photography','fa-camera',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Business','fa-briefcase',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('Mobile Apps','fa-mobile-alt',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "categories" ("name","icon","created_at","updated_at") VALUES ('SEO','fa-search',NOW(),NOW()) ON CONFLICT ("name") DO NOTHING;

COMMIT;
