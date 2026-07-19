-- Add detailed review criteria fields to reviews table
-- This script extends the existing reviews table to store detailed evaluation criteria

-- Add individual criterion scores (1-10 scale)
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS originality_score DECIMAL(3,1) CHECK (originality_score >= 1 AND originality_score <= 10),
ADD COLUMN IF NOT EXISTS relevance_score DECIMAL(3,1) CHECK (relevance_score >= 1 AND relevance_score <= 10),
ADD COLUMN IF NOT EXISTS literature_score DECIMAL(3,1) CHECK (literature_score >= 1 AND literature_score <= 10),
ADD COLUMN IF NOT EXISTS methodology_score DECIMAL(3,1) CHECK (methodology_score >= 1 AND methodology_score <= 10),
ADD COLUMN IF NOT EXISTS analysis_score DECIMAL(3,1) CHECK (analysis_score >= 1 AND analysis_score <= 10),
ADD COLUMN IF NOT EXISTS clarity_score DECIMAL(3,1) CHECK (clarity_score >= 1 AND clarity_score <= 10),
ADD COLUMN IF NOT EXISTS presentation_score DECIMAL(3,1) CHECK (presentation_score >= 1 AND presentation_score <= 10),
ADD COLUMN IF NOT EXISTS significance_score DECIMAL(3,1) CHECK (significance_score >= 1 AND significance_score <= 10),
ADD COLUMN IF NOT EXISTS ethics_score DECIMAL(3,1) CHECK (ethics_score >= 1 AND ethics_score <= 10);

-- Add individual criterion comments
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS originality_comment TEXT,
ADD COLUMN IF NOT EXISTS relevance_comment TEXT,
ADD COLUMN IF NOT EXISTS literature_comment TEXT,
ADD COLUMN IF NOT EXISTS methodology_comment TEXT,
ADD COLUMN IF NOT EXISTS analysis_comment TEXT,
ADD COLUMN IF NOT EXISTS clarity_comment TEXT,
ADD COLUMN IF NOT EXISTS presentation_comment TEXT,
ADD COLUMN IF NOT EXISTS significance_comment TEXT,
ADD COLUMN IF NOT EXISTS ethics_comment TEXT;

-- Add general feedback fields
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS strengths TEXT,
ADD COLUMN IF NOT EXISTS weaknesses TEXT,
ADD COLUMN IF NOT EXISTS additional_comments TEXT,
ADD COLUMN IF NOT EXISTS recommendation TEXT CHECK (recommendation IN ('accept', 'minor', 'major', 'reject'));

-- Add indexes for performance on new fields
CREATE INDEX IF NOT EXISTS reviews_recommendation_idx ON reviews(recommendation);
CREATE INDEX IF NOT EXISTS reviews_originality_score_idx ON reviews(originality_score);
CREATE INDEX IF NOT EXISTS reviews_overall_score_idx ON reviews(score);

-- Add comments for documentation
COMMENT ON COLUMN reviews.originality_score IS 'Score 1-10 for originality of the work';
COMMENT ON COLUMN reviews.relevance_score IS 'Score 1-10 for relevance to field/journal scope';
COMMENT ON COLUMN reviews.literature_score IS 'Score 1-10 for adequacy of literature review';
COMMENT ON COLUMN reviews.methodology_score IS 'Score 1-10 for soundness of research methodology';
COMMENT ON COLUMN reviews.analysis_score IS 'Score 1-10 for depth and quality of analysis';
COMMENT ON COLUMN reviews.clarity_score IS 'Score 1-10 for clarity and organization of writing';
COMMENT ON COLUMN reviews.presentation_score IS 'Score 1-10 for quality of figures, tables, and references';
COMMENT ON COLUMN reviews.significance_score IS 'Score 1-10 for significance and practical implications';
COMMENT ON COLUMN reviews.ethics_score IS 'Score 1-10 for ethical considerations and research integrity';

COMMENT ON COLUMN reviews.originality_comment IS 'Detailed comments on originality';
COMMENT ON COLUMN reviews.relevance_comment IS 'Detailed comments on relevance';
COMMENT ON COLUMN reviews.literature_comment IS 'Detailed comments on literature review';
COMMENT ON COLUMN reviews.methodology_comment IS 'Detailed comments on methodology';
COMMENT ON COLUMN reviews.analysis_comment IS 'Detailed comments on analysis';
COMMENT ON COLUMN reviews.clarity_comment IS 'Detailed comments on clarity';
COMMENT ON COLUMN reviews.presentation_comment IS 'Detailed comments on presentation';
COMMENT ON COLUMN reviews.significance_comment IS 'Detailed comments on significance';
COMMENT ON COLUMN reviews.ethics_comment IS 'Detailed comments on ethics';

COMMENT ON COLUMN reviews.strengths IS 'Identified strengths of the paper';
COMMENT ON COLUMN reviews.weaknesses IS 'Areas for improvement';
COMMENT ON COLUMN reviews.additional_comments IS 'Additional reviewer comments';
COMMENT ON COLUMN reviews.recommendation IS 'Final recommendation: accept, minor, major, reject';
COMMENT ON COLUMN reviews.score IS 'Average score calculated from individual criteria scores';

-- Create a view for easy access to complete review data
CREATE OR REPLACE VIEW detailed_reviews AS
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
  -- Calculate review completeness percentage
  CASE 
    WHEN r.status = 'COMPLETED' THEN 100
    WHEN r.status = 'IN_PROGRESS' THEN 50
    WHEN r.status = 'PENDING' THEN 0
    ELSE 0
  END as completion_percentage,
  -- Calculate days since assignment
  EXTRACT(DAY FROM (CURRENT_TIMESTAMP - r.assigned_at)) as days_since_assignment,
  -- Calculate days until due (can be negative if overdue)
  CASE 
    WHEN r.due_date IS NOT NULL THEN 
      EXTRACT(DAY FROM (r.due_date - CURRENT_TIMESTAMP))
    ELSE NULL
  END as days_until_due,
  -- Check if overdue
  CASE 
    WHEN r.due_date IS NOT NULL AND r.status != 'COMPLETED' AND r.due_date < CURRENT_TIMESTAMP THEN true
    ELSE false
  END as is_overdue
FROM reviews r
JOIN submissions s ON r.submission_id = s.id
JOIN authors a ON s.author_id = a.id
JOIN reviewer_applications ra ON r.reviewer_id = ra.id;

-- Grant necessary permissions for the view
COMMENT ON VIEW detailed_reviews IS 'Complete view of reviews with submission and reviewer details';

-- Update RLS policies to work with new fields
-- The existing policies should already cover the new columns since they use FOR ALL

-- Create a function to calculate average score from individual criteria
CREATE OR REPLACE FUNCTION calculate_review_average_score(
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
  -- Count non-null scores and sum them
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
  
  -- Return average if we have scores, otherwise NULL
  IF count_scores > 0 THEN
    RETURN ROUND(total_score / count_scores, 1);
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

COMMENT ON FUNCTION calculate_review_average_score IS 'Calculate average score from individual review criteria scores';

-- Create a trigger to automatically update the overall score when individual scores change
CREATE OR REPLACE FUNCTION update_review_overall_score()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate and set the overall score
  NEW.score := calculate_review_average_score(
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

-- Apply the trigger to automatically calculate overall score
DROP TRIGGER IF EXISTS calculate_overall_score_trigger ON reviews;
CREATE TRIGGER calculate_overall_score_trigger
  BEFORE INSERT OR UPDATE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_review_overall_score();

COMMENT ON TRIGGER calculate_overall_score_trigger ON reviews IS 'Automatically calculates overall score from individual criteria scores';