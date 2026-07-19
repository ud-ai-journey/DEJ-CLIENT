-- Add review completion tracking columns to submissions table
-- Safe to run multiple times (uses IF NOT EXISTS)

ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS review_completed_by TEXT,
ADD COLUMN IF NOT EXISTS review_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_completed_override BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS review_completed_reason TEXT;

-- Optional helpful indexes (no-ops if they already exist)
CREATE INDEX IF NOT EXISTS submissions_review_completed_at_idx ON submissions (review_completed_at);
CREATE INDEX IF NOT EXISTS submissions_review_completed_override_idx ON submissions (review_completed_override);

-- Ask PostgREST (Supabase API) to reload its schema cache so new columns are recognized immediately
DO $$ BEGIN
	PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
	-- Ignore if pg_notify is restricted; manual reload can be done from Supabase API settings
	NULL;
END $$;