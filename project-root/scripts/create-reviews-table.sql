-- Create reviews table for submission management
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL,
    reviewer_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DECLINED')),
    score DECIMAL(3,1) CHECK (score >= 0 AND score <= 10),
    comments TEXT,
    feedback TEXT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reviews_submission_reviewer_unique UNIQUE (submission_id, reviewer_id),
    CONSTRAINT reviews_submission_fk FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
    CONSTRAINT reviews_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES reviewer_applications(id) ON DELETE CASCADE
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS reviews_submission_id_idx ON reviews(submission_id);
CREATE INDEX IF NOT EXISTS reviews_reviewer_id_idx ON reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS reviews_status_idx ON reviews(status);
CREATE INDEX IF NOT EXISTS reviews_due_date_idx ON reviews(due_date);

-- Update submissions table to add missing columns for admin management
ALTER TABLE submissions 
ADD COLUMN IF NOT EXISTS decision_comments TEXT,
ADD COLUMN IF NOT EXISTS reviewer_notes TEXT,
ADD COLUMN IF NOT EXISTS file_url TEXT,
ADD COLUMN IF NOT EXISTS average_score DECIMAL(3,1);

-- Add admin role to account_emails table if not exists
ALTER TABLE account_emails 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' CHECK (role IN ('user', 'author', 'reviewer', 'admin'));

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to reviews table
DROP TRIGGER IF EXISTS update_reviews_updated_at ON reviews;
CREATE TRIGGER update_reviews_updated_at 
    BEFORE UPDATE ON reviews 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to submissions table
DROP TRIGGER IF EXISTS update_submissions_updated_at ON submissions;
CREATE TRIGGER update_submissions_updated_at 
    BEFORE UPDATE ON submissions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create RLS policies for reviews table
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can do everything
CREATE POLICY "Admins can manage all reviews" ON reviews
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM account_emails 
            WHERE email_lower = LOWER(auth.jwt() ->> 'email') 
            AND role = 'admin'
        )
    );

-- Policy: Reviewers can view and update their own reviews
CREATE POLICY "Reviewers can manage their own reviews" ON reviews
    FOR ALL USING (
        reviewer_id IN (
            SELECT ra.id FROM reviewer_applications ra
            JOIN account_emails ae ON LOWER(ra.applicant_email) = ae.email_lower
            WHERE ae.email_lower = LOWER(auth.jwt() ->> 'email')
        )
    );

-- Policy: Authors can view reviews of their submissions
CREATE POLICY "Authors can view reviews of their submissions" ON reviews
    FOR SELECT USING (
        submission_id IN (
            SELECT s.id FROM submissions s
            JOIN account_emails ae ON LOWER(s.owner_email) = ae.email_lower
            WHERE ae.email_lower = LOWER(auth.jwt() ->> 'email')
        )
    );

COMMENT ON TABLE reviews IS 'Tracks reviewer assignments and review progress for submissions';
COMMENT ON COLUMN reviews.status IS 'Current status of the review: PENDING, IN_PROGRESS, COMPLETED, DECLINED';
COMMENT ON COLUMN reviews.score IS 'Numerical score from 0-10 given by reviewer';
COMMENT ON COLUMN reviews.due_date IS 'Deadline for completing the review';