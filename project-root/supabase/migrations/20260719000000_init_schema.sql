-- =============================================================================
-- DEJ Database Schema Migration
-- Version: 20260719000000_init_schema
-- Description: Initializes all tables, indexes, views, triggers, functions, 
--              and RLS policies required for the DEJ platform.
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- =============================================================================
-- 1. UTILITY FUNCTIONS
-- =============================================================================

-- UUID v7 Generator (in case the version of PostgreSQL doesn't natively support it yet)
CREATE OR REPLACE FUNCTION public.gen_uuid_v7() 
RETURNS uuid 
AS $$
DECLARE
  timestamp_ms bigint;
  bytes bytea;
BEGIN
  timestamp_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  bytes := decode(lpad(to_hex(timestamp_ms), 12, '0') || '7' || substr(to_hex(floor(random() * 4096)::int), 2, 3) || '8' || substr(to_hex(floor(random() * 4096)::int), 2, 3) || to_hex(floor(random() * 4294967296)::bigint), 'hex');
  return bytes::uuid;
END;
$$ LANGUAGE plpgsql;

-- Table structure verification helper (used by validation scripts)
CREATE OR REPLACE FUNCTION public.check_table_structure(table_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' 
    AND t.table_name = check_table_structure.table_name
  );
END;
$$;

-- Table column checking helper (used by migration checks)
CREATE OR REPLACE FUNCTION public.get_table_columns(table_name text)
RETURNS TABLE(column_name text, data_type text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT c.column_name::text, c.data_type::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  AND c.table_name = get_table_columns.table_name;
END;
$$;


-- Function listing helper (used by validation scripts)
CREATE OR REPLACE FUNCTION public.list_functions()
RETURNS TABLE(function_name text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT routine_name::text
  FROM information_schema.routines
  WHERE routine_schema = 'public';
END;
$$;

-- Timestamp auto-update trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. TABLES AND INDEXES
-- =============================================================================

-- Table: account_emails
CREATE TABLE public.account_emails (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    email_lower TEXT UNIQUE NOT NULL,
    account_uid UUID DEFAULT gen_random_uuid() UNIQUE,
    auth_user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'author', 'reviewer', 'admin'))
);

CREATE INDEX idx_account_emails_lower ON public.account_emails(email_lower);
CREATE INDEX idx_account_emails_auth_id ON public.account_emails(auth_user_id);

-- Trigger to lowercase email on insert/update
CREATE OR REPLACE FUNCTION public.set_account_email_lower()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email_lower := LOWER(NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_emails_email_lower_trg
  BEFORE INSERT OR UPDATE ON public.account_emails
  FOR EACH ROW
  EXECUTE FUNCTION public.set_account_email_lower();


-- Table: authors
CREATE TABLE public.authors (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    email_lower TEXT UNIQUE NOT NULL,
    author_uid UUID DEFAULT gen_random_uuid() UNIQUE,
    full_name TEXT,
    affiliation TEXT,
    location TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    research_interests TEXT,
    profile_data JSONB DEFAULT '{}'
);

CREATE INDEX idx_authors_email_lower ON public.authors(email_lower);

-- Trigger to lowercase email on insert/update
CREATE OR REPLACE FUNCTION public.set_author_email_lower()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email_lower := LOWER(NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER authors_email_lower_trg
  BEFORE INSERT OR UPDATE ON public.authors
  FOR EACH ROW
  EXECUTE FUNCTION public.set_author_email_lower();


-- Table: submissions
CREATE TABLE public.submissions (
    id SERIAL PRIMARY KEY,
    user_id TEXT, -- Matches auth_user_id of account_emails
    owner_email TEXT NOT NULL,
    owner_email_lower TEXT NOT NULL,
    first_author_email TEXT NOT NULL,
    first_author_email_lower TEXT NOT NULL,
    title TEXT NOT NULL,
    paper_type TEXT DEFAULT 'Research Paper',
    abstract TEXT,
    keywords_text TEXT,
    terms_accepted BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'submitted',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    coauthor_emails TEXT[],
    metadata JSONB DEFAULT '{}',
    decision_comments TEXT,
    reviewer_notes TEXT,
    file_url TEXT,
    average_score DECIMAL(3,1),
    
    -- Admin columns
    is_verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    verified_by TEXT,
    verification_notes TEXT,
    published_at TIMESTAMPTZ,
    published_by TEXT,
    publication_url TEXT,
    doi TEXT,
    volume TEXT,
    issue TEXT,
    pages TEXT,
    revision_requested_at TIMESTAMPTZ,
    revision_requested_by TEXT,
    revision_comments TEXT,
    revision_deadline TIMESTAMPTZ,
    
    -- Rejection columns
    rejected_by TEXT,
    rejected_at TIMESTAMPTZ,
    rejection_comments TEXT,
    
    -- Review completion columns
    review_completed_by TEXT,
    review_completed_at TIMESTAMPTZ,
    review_completed_override BOOLEAN DEFAULT FALSE,
    review_completed_reason TEXT
);

CREATE INDEX idx_submissions_status ON public.submissions(status);
CREATE INDEX idx_submissions_verified ON public.submissions(is_verified);
CREATE INDEX idx_submissions_published_at ON public.submissions(published_at);
CREATE INDEX idx_submissions_first_author_lower ON public.submissions(first_author_email_lower);
CREATE INDEX idx_submissions_owner_lower ON public.submissions(owner_email_lower);

-- Trigger to lowercase emails on insert/update
CREATE OR REPLACE FUNCTION public.set_submission_emails_lower()
RETURNS TRIGGER AS $$
BEGIN
  NEW.owner_email_lower := LOWER(NEW.owner_email);
  NEW.first_author_email_lower := LOWER(NEW.first_author_email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submissions_emails_lower_trg
  BEFORE INSERT OR UPDATE ON public.submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_submission_emails_lower();

CREATE TRIGGER update_submissions_updated_at 
    BEFORE UPDATE ON public.submissions 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();


-- Table: submission_files
CREATE TABLE public.submission_files (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER REFERENCES public.submissions(id) ON DELETE CASCADE,
    storage_bucket TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT,
    byte_size BIGINT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    file_version INTEGER DEFAULT 1,
    checksum TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_submission_files_submission_id ON public.submission_files(submission_id);


-- Table: reviewer_applications
CREATE TABLE public.reviewer_applications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID, -- References account_emails account_uid
    applicant_email TEXT NOT NULL,
    applicant_email_lower TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    degree TEXT,
    experience TEXT,
    institution TEXT,
    cv_bucket TEXT,
    cv_key TEXT,
    cv_url TEXT,
    status TEXT DEFAULT 'PENDING',
    expertise_areas TEXT[],
    expertise_keywords_text TEXT,
    availability TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Admin approval columns
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    verification_notes TEXT,
    rejected_by TEXT,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    rejection_notes TEXT
);

CREATE INDEX idx_reviewer_apps_email_lower ON public.reviewer_applications(applicant_email_lower);
CREATE INDEX idx_reviewer_apps_status ON public.reviewer_applications(status);

-- Trigger to lowercase email on insert/update
CREATE OR REPLACE FUNCTION public.set_reviewer_email_lower()
RETURNS TRIGGER AS $$
BEGIN
  NEW.applicant_email_lower := LOWER(NEW.applicant_email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reviewer_applications_email_lower_trg
  BEFORE INSERT OR UPDATE ON public.reviewer_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_reviewer_email_lower();

CREATE TRIGGER update_reviewer_apps_updated_at 
    BEFORE UPDATE ON public.reviewer_applications 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();


-- Table: reviews
CREATE TABLE public.reviews (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.reviewer_applications(id) ON DELETE CASCADE,
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
    
    -- Scoring details
    originality_score DECIMAL(3,1) CHECK (originality_score >= 1 AND originality_score <= 10),
    relevance_score DECIMAL(3,1) CHECK (relevance_score >= 1 AND relevance_score <= 10),
    literature_score DECIMAL(3,1) CHECK (literature_score >= 1 AND literature_score <= 10),
    methodology_score DECIMAL(3,1) CHECK (methodology_score >= 1 AND methodology_score <= 10),
    analysis_score DECIMAL(3,1) CHECK (analysis_score >= 1 AND analysis_score <= 10),
    clarity_score DECIMAL(3,1) CHECK (clarity_score >= 1 AND clarity_score <= 10),
    presentation_score DECIMAL(3,1) CHECK (presentation_score >= 1 AND presentation_score <= 10),
    significance_score DECIMAL(3,1) CHECK (significance_score >= 1 AND significance_score <= 10),
    ethics_score DECIMAL(3,1) CHECK (ethics_score >= 1 AND ethics_score <= 10),
    
    -- Score comments
    originality_comment TEXT,
    relevance_comment TEXT,
    literature_comment TEXT,
    methodology_comment TEXT,
    analysis_comment TEXT,
    clarity_comment TEXT,
    presentation_comment TEXT,
    significance_comment TEXT,
    ethics_comment TEXT,
    
    -- General qualitative feedback
    strengths TEXT,
    weaknesses TEXT,
    additional_comments TEXT,
    recommendation TEXT CHECK (recommendation IN ('accept', 'minor', 'major', 'reject')),
    
    -- Admin fields
    assigned_by TEXT,
    reminder_sent BOOLEAN DEFAULT FALSE,
    reminder_sent_at TIMESTAMPTZ,
    reminder_count INTEGER DEFAULT 0,
    last_reminder_by TEXT,
    admin_completed BOOLEAN DEFAULT FALSE,
    admin_completed_by TEXT,
    reassigned_by TEXT,
    reassigned_at TIMESTAMPTZ,
    reassignment_reason TEXT,
    previous_reviewer_id TEXT,
    
    CONSTRAINT reviews_submission_reviewer_unique UNIQUE (submission_id, reviewer_id)
);

CREATE INDEX idx_reviews_submission_id ON public.reviews(submission_id);
CREATE INDEX idx_reviews_reviewer_id ON public.reviews(reviewer_id);
CREATE INDEX idx_reviews_status ON public.reviews(status);
CREATE INDEX idx_reviews_due_date ON public.reviews(due_date);
CREATE INDEX idx_reviews_recommendation ON public.reviews(recommendation);
CREATE INDEX idx_reviews_overall_score ON public.reviews(score);

CREATE TRIGGER update_reviews_updated_at 
    BEFORE UPDATE ON public.reviews 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();

-- Function and trigger for automatically calculating overall review score
CREATE OR REPLACE FUNCTION public.calculate_review_average_score(
  p_originality DECIMAL(3,1),
  p_relevance DECIMAL(3,1),
  p_literature DECIMAL(3,1),
  p_methodology DECIMAL(3,1),
  p_analysis DECIMAL(3,1),
  p_clarity DECIMAL(3,1),
  p_presentation DECIMAL(3,1),
  p_significance DECIMAL(3,1),
  p_ethics DECIMAL(3,1)
)
RETURNS DECIMAL(3,1)
LANGUAGE plpgsql
AS $$
DECLARE
  total_score DECIMAL := 0;
  count_scores INTEGER := 0;
BEGIN
  IF p_originality IS NOT NULL THEN
    total_score := total_score + p_originality;
    count_scores := count_scores + 1;
  END IF;
  IF p_relevance IS NOT NULL THEN
    total_score := total_score + p_relevance;
    count_scores := count_scores + 1;
  END IF;
  IF p_literature IS NOT NULL THEN
    total_score := total_score + p_literature;
    count_scores := count_scores + 1;
  END IF;
  IF p_methodology IS NOT NULL THEN
    total_score := total_score + p_methodology;
    count_scores := count_scores + 1;
  END IF;
  IF p_analysis IS NOT NULL THEN
    total_score := total_score + p_analysis;
    count_scores := count_scores + 1;
  END IF;
  IF p_clarity IS NOT NULL THEN
    total_score := total_score + p_clarity;
    count_scores := count_scores + 1;
  END IF;
  IF p_presentation IS NOT NULL THEN
    total_score := total_score + p_presentation;
    count_scores := count_scores + 1;
  END IF;
  IF p_significance IS NOT NULL THEN
    total_score := total_score + p_significance;
    count_scores := count_scores + 1;
  END IF;
  IF p_ethics IS NOT NULL THEN
    total_score := total_score + p_ethics;
    count_scores := count_scores + 1;
  END IF;
  
  IF count_scores > 0 THEN
    RETURN ROUND(total_score / count_scores, 1);
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_review_overall_score()
RETURNS TRIGGER AS $$
BEGIN
  NEW.score := public.calculate_review_average_score(
    NEW.originality_score,
    NEW.relevance_score,
    NEW.literature_score,
    NEW.methodology_score,
    NEW.analysis_score,
    NEW.clarity_score,
    NEW.presentation_score,
    NEW.significance_score,
    NEW.ethics_score
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_overall_score_trigger
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_review_overall_score();


-- Table: submission_authors
CREATE TABLE public.submission_authors (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER REFERENCES public.submissions(id) ON DELETE CASCADE,
    author_email TEXT NOT NULL,
    author_order INTEGER NOT NULL,
    receive_communications BOOLEAN DEFAULT FALSE,
    CONSTRAINT submission_authors_submission_email_unique UNIQUE (submission_id, author_email)
);

CREATE INDEX idx_submission_authors_sub_id ON public.submission_authors(submission_id);


-- Table: keywords
CREATE TABLE public.keywords (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE INDEX idx_keywords_name ON public.keywords(name);


-- Table: submission_keywords
CREATE TABLE public.submission_keywords (
    submission_id INTEGER REFERENCES public.submissions(id) ON DELETE CASCADE,
    keyword_id INTEGER REFERENCES public.keywords(id) ON DELETE CASCADE,
    PRIMARY KEY (submission_id, keyword_id)
);


-- Table: admin_actions
CREATE TABLE public.admin_actions (
    id SERIAL PRIMARY KEY,
    admin_id TEXT NOT NULL, -- Email address
    action TEXT NOT NULL,
    target_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- Table: admin_audit_log
CREATE TABLE public.admin_audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    target_user_id TEXT,
    admin_user_id TEXT,
    reason TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    details JSONB DEFAULT '{}'
);


-- Table: admin_deleted_submissions
CREATE TABLE public.admin_deleted_submissions (
    id SERIAL PRIMARY KEY,
    original_submission_id INTEGER,
    submission_data JSONB NOT NULL,
    deletion_reason TEXT,
    deleted_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_by TEXT
);


-- Table: submission_periods
CREATE TABLE public.submission_periods (
    id SERIAL PRIMARY KEY,
    name TEXT,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- Table: submission_reviews
CREATE TABLE public.submission_reviews (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER REFERENCES public.submissions(id) ON DELETE CASCADE,
    reviewer_id TEXT,
    rating INTEGER,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 3. VIEWS
-- =============================================================================

-- Detailed reviews view
CREATE OR REPLACE VIEW public.detailed_reviews AS
SELECT 
  r.*,
  s.title as submission_title,
  s.paper_type,
  s.status as submission_status,
  a.full_name as author_name,
  a.email as author_email,
  ra.full_name as reviewer_name,
  ra.applicant_email as reviewer_email,
  ra.institution as reviewer_institution,
  CASE 
    WHEN r.status = 'COMPLETED' THEN 100
    WHEN r.status = 'IN_PROGRESS' THEN 50
    WHEN r.status = 'PENDING' THEN 0
    ELSE 0
  END as completion_percentage,
  EXTRACT(DAY FROM (CURRENT_TIMESTAMP - r.assigned_at)) as days_since_assignment,
  CASE 
    WHEN r.due_date IS NOT NULL THEN 
      EXTRACT(DAY FROM (r.due_date - CURRENT_TIMESTAMP))
    ELSE NULL
  END as days_until_due,
  CASE 
    WHEN r.due_date IS NOT NULL AND r.status != 'COMPLETED' AND r.due_date < CURRENT_TIMESTAMP THEN true
    ELSE false
  END as is_overdue
FROM public.reviews r
JOIN public.submissions s ON r.submission_id = s.id
JOIN public.authors a ON s.first_author_email_lower = a.email_lower
JOIN public.reviewer_applications ra ON r.reviewer_id = ra.id;

-- =============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- Enable RLS on reviews table
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all reviews" ON public.reviews
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.account_emails 
            WHERE email_lower = LOWER(auth.jwt() ->> 'email') 
            AND role = 'admin'
        )
    );

CREATE POLICY "Reviewers can manage their own reviews" ON public.reviews
    FOR ALL USING (
        reviewer_id IN (
            SELECT ra.id FROM public.reviewer_applications ra
            JOIN public.account_emails ae ON LOWER(ra.applicant_email) = ae.email_lower
            WHERE ae.email_lower = LOWER(auth.jwt() ->> 'email')
        )
    );

CREATE POLICY "Authors can view reviews of their submissions" ON public.reviews
    FOR SELECT USING (
        submission_id IN (
            SELECT s.id FROM public.submissions s
            JOIN public.account_emails ae ON LOWER(s.owner_email) = ae.email_lower
            WHERE ae.email_lower = LOWER(auth.jwt() ->> 'email')
        )
    );

-- Missing relationship foreign keys
ALTER TABLE public.submissions
  ADD CONSTRAINT fk_submissions_first_author_email_lower
  FOREIGN KEY (first_author_email_lower)
  REFERENCES public.authors(email_lower)
  ON DELETE RESTRICT;

ALTER TABLE public.reviewer_applications
  ADD CONSTRAINT fk_reviewer_apps_user_id
  FOREIGN KEY (user_id)
  REFERENCES public.account_emails(account_uid)
  ON DELETE SET NULL;

