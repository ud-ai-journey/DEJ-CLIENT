# Admin Panel Schema Alignment

The admin services expect a handful of reviewer, review, and submission metadata columns that are missing from the default Supabase schema. Run the following SQL statements (in order) inside your Supabase SQL editor to add the required columns safely. All commands use `IF NOT EXISTS` so they can be re-run without breaking existing environments.

## Reviewer applications

```sql
-- Core approval / rejection metadata
ALTER TABLE reviewer_applications
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejection_notes TEXT;

-- Normalized email lookup used across the admin API
ALTER TABLE reviewer_applications
  ADD COLUMN IF NOT EXISTS applicant_email_lower TEXT;

UPDATE reviewer_applications
SET applicant_email_lower = LOWER(applicant_email)
WHERE applicant_email IS NOT NULL
  AND (applicant_email_lower IS NULL OR applicant_email_lower <> LOWER(applicant_email));

CREATE OR REPLACE FUNCTION set_reviewer_email_lower()
RETURNS TRIGGER AS $$
BEGIN
  NEW.applicant_email_lower := LOWER(NEW.applicant_email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reviewer_applications_email_lower_trg ON reviewer_applications;
CREATE TRIGGER reviewer_applications_email_lower_trg
  BEFORE INSERT OR UPDATE ON reviewer_applications
  FOR EACH ROW
  EXECUTE FUNCTION set_reviewer_email_lower();

CREATE INDEX IF NOT EXISTS reviewer_applications_email_lower_idx
  ON reviewer_applications (applicant_email_lower);
```

## Reviews

```sql
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS assigned_by TEXT,
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_by TEXT,
  ADD COLUMN IF NOT EXISTS admin_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_completed_by TEXT,
  ADD COLUMN IF NOT EXISTS recommendation TEXT,
  ADD COLUMN IF NOT EXISTS reassigned_by TEXT,
  ADD COLUMN IF NOT EXISTS reassigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reassignment_reason TEXT,
  ADD COLUMN IF NOT EXISTS previous_reviewer_id TEXT;

ALTER TABLE reviews
  ALTER COLUMN reminder_count SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS reviews_reminder_pending_idx
  ON reviews (status, reminder_sent)
  WHERE status <> 'COMPLETED';
```

## Submissions

```sql
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by TEXT,
  ADD COLUMN IF NOT EXISTS publication_url TEXT,
  ADD COLUMN IF NOT EXISTS doi TEXT,
  ADD COLUMN IF NOT EXISTS volume TEXT,
  ADD COLUMN IF NOT EXISTS issue TEXT,
  ADD COLUMN IF NOT EXISTS pages TEXT,
  ADD COLUMN IF NOT EXISTS revision_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision_requested_by TEXT,
  ADD COLUMN IF NOT EXISTS revision_comments TEXT,
  ADD COLUMN IF NOT EXISTS revision_deadline TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS submissions_status_idx ON submissions (status);
CREATE INDEX IF NOT EXISTS submissions_verified_idx ON submissions (is_verified);
CREATE INDEX IF NOT EXISTS submissions_published_idx ON submissions (published_at);
```

> Tip: after applying these changes, re-run `npm run verify-supabase-schema` (or the equivalent health check) to confirm your Supabase project now matches the admin service expectations.
