import supabase from '../../config/supabase.js';
import { getAccountByEmail } from './account-service.js';
import { getReviewerApplicationByEmail } from './reviewer-service.js';

/**
 * Enhanced review service for detailed review feedback management
 * 
 * Database Schema:
 * - id (UUID): Unique identifier for each review record
 * - submission_id (UUID): Links to the submission being reviewed  
 * - reviewer_id (UUID): Links to the assigned reviewer
 * - status: PENDING, IN_PROGRESS, COMPLETED, DECLINED
 */

/**
 * Get a review by submission ID and reviewer ID (for finding if reviewer has review for submission)
 * @param {string} submissionId - Submission UUID
 * @param {string} reviewerId - Reviewer UUID  
 * @returns {Promise<Object|null>} - Review data or null if not found
 */
export async function getReviewBySubmissionAndReviewer(submissionId, reviewerId) {
  try {
    // Both submission_id and reviewer_id are UUIDs in the database
    const reviewerIdStr = String(reviewerId);
    const submissionIdStr = String(submissionId);
    
    console.log('Finding review by submission + reviewer:', { submissionId: submissionIdStr, reviewerId: reviewerIdStr });
    
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        submission:submissions(
          id,
          title,
          abstract,
          paper_type,
          author:authors(full_name, email)
        ),
        reviewer:reviewer_applications(
          id,
          full_name,
          applicant_email
        )
      `)
      .eq('submission_id', submissionIdStr)
      .eq('reviewer_id', reviewerIdStr)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
      console.error('Error getting review by submission+reviewer:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error in getReviewBySubmissionAndReviewer:', error);
    throw error;
  }
}

/**
 * Get a specific review by its unique ID (for editing/updating specific review)
 * @param {string} reviewId - Review UUID
 * @returns {Promise<Object|null>} - Review data or null if not found
 */
export async function getReviewById(reviewId) {
  try {
    const reviewIdStr = String(reviewId);
    
    console.log('Finding review by ID:', reviewIdStr);
    
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        submission:submissions(
          id,
          title,
          abstract,
          paper_type,
          author:authors(full_name, email)
        ),
        reviewer:reviewer_applications(
          id,
          full_name,
          applicant_email
        )
      `)
      .eq('id', reviewIdStr)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error getting review by ID:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error in getReviewById:', error);
    throw error;
  }
}

/**
 * Get all reviews for a specific submission (for admin dashboard)
 * @param {string} submissionId - Submission UUID
 * @returns {Promise<Array>} - Array of reviews for the submission
 */
export async function getReviewsBySubmissionId(submissionId) {
  try {
    const submissionIdStr = String(submissionId);
    
    console.log('Finding all reviews for submission:', submissionIdStr);
    
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        reviewer:reviewer_applications(
          id,
          full_name,
          applicant_email,
          institution
        )
      `)
      .eq('submission_id', submissionIdStr)
      .order('assigned_at', { ascending: true });

    if (error) {
      console.error('Error getting reviews by submission ID:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error in getReviewsBySubmissionId:', error);
    throw error;
  }
}

/**
 * Get a review by submission ID for the current authenticated user
 * @param {number} submissionId - Submission ID
 * @param {string} userEmail - User's email
 * @returns {Promise<Object|null>} - Review data or null if not found
 */
export async function getReviewBySubmissionForUser(submissionId, userEmail) {
  try {
    // First get the reviewer application for this user
    const reviewerApp = await getReviewerApplicationByEmail(userEmail);
    if (!reviewerApp) {
      throw new Error('User is not a registered reviewer');
    }

    return await getReviewBySubmissionAndReviewer(submissionId, String(reviewerApp.id));
  } catch (error) {
    console.error('Error in getReviewBySubmissionForUser:', error);
    throw error;
  }
}

/**
 * Create or update a detailed review
 * @param {number} submissionId - Submission ID
 * @param {string} userEmail - Reviewer's email
 * @param {Object} reviewData - Detailed review data
 * @returns {Promise<Object>} - Created or updated review
 */
export async function submitReview(submissionId, userEmail, reviewData) {
  try {
    // Get reviewer application
    const reviewerApp = await getReviewerApplicationByEmail(userEmail);
    if (!reviewerApp) {
      throw new Error('User is not a registered reviewer');
    }

    console.log('Reviewer app found:', { id: reviewerApp.id, email: reviewerApp.applicant_email });

    // Check if review already exists (convert ID to string for consistency)
    const existingReview = await getReviewBySubmissionAndReviewer(submissionId, String(reviewerApp.id));

    // Calculate average score from individual criteria scores
    const criteriaScores = [
      reviewData.originality,
      reviewData.relevance,
      reviewData.literature,
      reviewData.methodology,
      reviewData.analysis,
      reviewData.clarity,
      reviewData.presentation,
      reviewData.significance,
      reviewData.ethics
    ].filter(score => score !== null && score !== undefined);

    const averageScore = criteriaScores.length > 0 
      ? criteriaScores.reduce((sum, score) => sum + Number(score), 0) / criteriaScores.length
      : null;

    // Prepare detailed review data
    const detailedReviewData = {
      // Individual criterion scores
      originality_score: reviewData.originality || null,
      relevance_score: reviewData.relevance || null,
      literature_score: reviewData.literature || null,
      methodology_score: reviewData.methodology || null,
      analysis_score: reviewData.analysis || null,
      clarity_score: reviewData.clarity || null,
      presentation_score: reviewData.presentation || null,
      significance_score: reviewData.significance || null,
      ethics_score: reviewData.ethics || null,

      // Individual criterion comments
      originality_comment: reviewData.originalityComment || null,
      relevance_comment: reviewData.relevanceComment || null,
      literature_comment: reviewData.literatureComment || null,
      methodology_comment: reviewData.methodologyComment || null,
      analysis_comment: reviewData.analysisComment || null,
      clarity_comment: reviewData.clarityComment || null,
      presentation_comment: reviewData.presentationComment || null,
      significance_comment: reviewData.significanceComment || null,
      ethics_comment: reviewData.ethicsComment || null,

      // General feedback
      strengths: reviewData.strengths || null,
      weaknesses: reviewData.weaknesses || null,
      additional_comments: reviewData.comments || null,
      recommendation: reviewData.recommendation || null,

      // Overall score and status
      score: averageScore,
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Set started_at if not already set
    if (!existingReview?.started_at) {
      detailedReviewData.started_at = new Date().toISOString();
    }

    let reviewResult;

    if (existingReview) {
      // Update existing review
      const { data, error } = await supabase
        .from('reviews')
        .update(detailedReviewData)
        .eq('id', existingReview.id)
        .select(`
          *,
          submission:submissions(
            id,
            title,
            author:authors(full_name, email)
          ),
          reviewer:reviewer_applications(
            full_name,
            applicant_email
          )
        `)
        .single();

      if (error) {
        console.error('Error updating review:', error);
        throw error;
      }

      reviewResult = data;
    } else {
      // Create new review (this should rarely happen as reviews are typically pre-assigned)
      const newReviewData = {
        submission_id: String(submissionId), // Ensure UUID string format
        reviewer_id: String(reviewerApp.id), // Ensure UUID string format
        assigned_at: new Date().toISOString(),
        ...detailedReviewData
      };

      console.log('Creating new review with UUID data:', { 
        submission_id: String(submissionId), 
        reviewer_id: String(reviewerApp.id) 
      });

      const { data, error } = await supabase
        .from('reviews')
        .insert(newReviewData)
        .select(`
          *,
          submission:submissions(
            id,
            title,
            author:authors(full_name, email)
          ),
          reviewer:reviewer_applications(
            full_name,
            applicant_email
          )
        `)
        .single();

      if (error) {
        console.error('Error creating review:', error);
        throw error;
      }

      reviewResult = data;
    }

    // Check if all reviews for this submission are completed
    await updateSubmissionReviewStatus(submissionId);

    return reviewResult;
  } catch (error) {
    console.error('Error in submitReview:', error);
    throw error;
  }
}

/**
 * Get all reviews assigned to a specific reviewer (for reviewer dashboard)
 * @param {string} reviewerId - Reviewer UUID
 * @returns {Promise<Array>} - Array of reviews assigned to the reviewer
 */
export async function getReviewsByReviewerId(reviewerId) {
  try {
    const reviewerIdStr = String(reviewerId);
    
    console.log('Finding all reviews for reviewer:', reviewerIdStr);
    
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        submission:submissions(
          id,
          title,
          abstract,
          paper_type,
          submitted_at,
          author:authors(full_name, email)
        )
      `)
      .eq('reviewer_id', reviewerIdStr)
      .order('assigned_at', { ascending: false }); // Most recent assignments first

    if (error) {
      console.error('Error getting reviews by reviewer ID:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error in getReviewsByReviewerId:', error);
    throw error;
  }
}

/**
 * Update review status to in-progress when reviewer starts working
 * @param {number} submissionId - Submission ID
 * @param {string} userEmail - Reviewer's email
 * @returns {Promise<Object>} - Updated review
 */
export async function startReview(submissionId, userEmail) {
  try {
    // Get reviewer application
    const reviewerApp = await getReviewerApplicationByEmail(userEmail);
    if (!reviewerApp) {
      throw new Error('User is not a registered reviewer');
    }

    // Get existing review
    const existingReview = await getReviewBySubmissionAndReviewer(submissionId, String(reviewerApp.id));
    if (!existingReview) {
      throw new Error('Review assignment not found');
    }

    if (existingReview.status === 'COMPLETED') {
      return existingReview; // Already completed
    }

    // Update status to in-progress if not already started
    const updateData = {
      status: 'IN_PROGRESS',
      updated_at: new Date().toISOString()
    };

    // Set started_at if not already set
    if (!existingReview.started_at) {
      updateData.started_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('reviews')
      .update(updateData)
      .eq('id', existingReview.id)
      .select(`
        *,
        submission:submissions(
          id,
          title,
          author:authors(full_name, email)
        ),
        reviewer:reviewer_applications(
          full_name,
          applicant_email
        )
      `)
      .single();

    if (error) {
      console.error('Error starting review:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error in startReview:', error);
    throw error;
  }
}

/**
 * Check if all reviews for a submission are completed and update submission status
 * @param {number} submissionId - Submission ID
 * @returns {Promise<void>}
 */
async function updateSubmissionReviewStatus(submissionId) {
  try {
    // Get all reviews for this submission (submission_id is UUID)
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('id, status')
      .eq('submission_id', String(submissionId)); // Ensure UUID string format

    if (error) {
      console.error('Error checking review status:', error);
      return;
    }

    if (reviews && reviews.length > 0) {
      const incompleteReviews = reviews.filter(r => r.status !== 'COMPLETED');
      
      // If all reviews are completed, update submission status
      if (incompleteReviews.length === 0) {
        const { error: updateError } = await supabase
          .from('submissions')
          .update({ 
            status: 'review_completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', String(submissionId)); // Ensure UUID string format

        if (updateError) {
          console.error('Error updating submission status:', updateError);
        }
      }
    }
  } catch (error) {
    console.error('Error in updateSubmissionReviewStatus:', error);
  }
}

/**
 * Get all reviews for a reviewer (for dashboard)
 * @param {string} userEmail - Reviewer's email
 * @returns {Promise<Array>} - Array of reviews assigned to the reviewer
 */
export async function getReviewsForReviewer(userEmail) {
  try {
    // Get reviewer application
    const reviewerApp = await getReviewerApplicationByEmail(userEmail);
    if (!reviewerApp) {
      return [];
    }

    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        submission:submissions(
          id,
          title,
          paper_type,
          status,
          author:authors(full_name, email),
          submission_files:submission_files(
            id,
            original_filename,
            mime_type
          )
        )
      `)
      .eq('reviewer_id', String(reviewerApp.id))
      .order('assigned_at', { ascending: false });

    if (error) {
      console.error('Error getting reviews for reviewer:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error in getReviewsForReviewer:', error);
    throw error;
  }
}

/**
 * Check if user has permission to review a specific submission
 * @param {number} submissionId - Submission ID
 * @param {string} userEmail - User's email
 * @returns {Promise<boolean>} - True if user can review this submission
 */
export async function canUserReviewSubmission(submissionId, userEmail) {
  try {
    const review = await getReviewBySubmissionForUser(submissionId, userEmail);
    return review !== null;
  } catch (error) {
    console.error('Error checking review permission:', error);
    return false;
  }
}