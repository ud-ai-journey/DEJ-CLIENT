-- Update submissions table with admin-managed rejection metadata
-- Safe to run multiple times (uses IF NOT EXISTS)

ALTER TABLE submissions
	ADD COLUMN IF NOT EXISTS rejected_by TEXT,
	ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS rejection_comments TEXT;

-- Optional helpful indexes (no-ops if they already exist)
CREATE INDEX IF NOT EXISTS submissions_status_idx ON submissions (status);
CREATE INDEX IF NOT EXISTS submissions_rejected_at_idx ON submissions (rejected_at);

-- Ask PostgREST (Supabase API) to reload its schema cache so new columns are recognized immediately
DO $$ BEGIN
	PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
	-- Ignore if pg_notify is restricted; manual reload can be done from Supabase API settings
	NULL;
END $$;

