import supabase from '../../config/supabase.js';
import { logAdminAction, ADMIN_ACTIONS, RESOURCE_TYPES } from './admin-audit-service.js';

/**
 * Enhanced admin review management service
 */

/**
 * Get all reviews for a specific submission
 * @param {number} submissionId - Submission ID
 * @param {string} adminEmail - Admin's email for audit logging
 * @returns {Promise<Array>} - Array of reviews for the submission
 */
export async function getSubmissionReviewsForAdmin(submissionId, adminEmail = 'admin@system') {
  try {
    const buildSelect = (includeExpertise = true) => `
      *,
      reviewer:reviewer_applications(
        id,
        full_name,
        applicant_email,
        institution${includeExpertise ? ',\n        expertise_keywords_text' : ''},
        status
      ),
      submission:submissions(
        id,
        title,
        status,
        paper_type,
        author:authors(full_name, email)
      )
    `;

    const fetchReviews = async (includeExpertise = true) =>
      supabase
        .from('reviews')
        .select(buildSelect(includeExpertise))
        .eq('submission_id', submissionId)
        .order('assigned_at', { ascending: true });

    let { data: reviews, error } = await fetchReviews(true);

    if (error && error.code === '42703') {
      console.warn('expertise_keywords_text column missing in reviewer_applications table, retrying without it.');
      ({ data: reviews, error } = await fetchReviews(false));
      if (!error && reviews) {
        reviews = reviews.map(review => ({
          ...review,
          reviewer: {
            ...review.reviewer,
            expertise_areas: []
          }
        }));
      }
    }

    if (error) {
      console.error('Error fetching submission reviews:', error);
      throw error;
    }

    // Enhance reviews with additional metadata
    const enhancedReviews = reviews?.map(review => {
      const timelines = {
        assigned: review.assigned_at,
        started: review.started_at,
        completed: review.completed_at,
        due: review.due_date
      };

      // Calculate review duration
      let reviewDuration = null;
      if (review.completed_at && review.assigned_at) {
        const assignedDate = new Date(review.assigned_at);
        const completedDate = new Date(review.completed_at);
        reviewDuration = Math.ceil((completedDate - assignedDate) / (1000 * 60 * 60 * 24));
      }

      // Calculate days remaining or overdue
      let daysRemaining = null;
      let isOverdue = false;
      if (review.due_date && review.status !== 'COMPLETED') {
        const now = new Date();
        const dueDate = new Date(review.due_date);
        const diffTime = dueDate - now;
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isOverdue = daysRemaining < 0;
      }

      return {
        ...review,
        timelines,
        review_duration_days: reviewDuration,
        days_remaining: daysRemaining,
        is_overdue: isOverdue,
        reviewer_expertise_match: review.reviewer?.expertise_areas || [],
        can_send_reminder: review.status !== 'COMPLETED' && !review.reminder_sent,
        progress_percentage: review.status === 'COMPLETED' ? 100 : 
                           review.status === 'IN_PROGRESS' ? 50 : 10
      };
    }) || [];

    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEW_VIEW,
      RESOURCE_TYPES.SUBMISSION,
      submissionId,
      { viewed_reviews: true, review_count: enhancedReviews.length }
    );

    return enhancedReviews;
  } catch (err) {
    console.error('Error in getSubmissionReviewsForAdmin:', err);
    throw err;
  }
}

/**
 * Get detailed review information
 * @param {number} reviewId - Review ID
 * @param {string} adminEmail - Admin's email for audit logging
 * @returns {Promise<Object>} - Detailed review data
 */
export async function getReviewDetailsForAdmin(reviewId, adminEmail = 'admin@system') {
  try {
    const buildSelect = (includeExpertise = true) => `
      *,
      reviewer:reviewer_applications(
        id,
        full_name,
        applicant_email,
        institution${includeExpertise ? ',\n        expertise_keywords_text' : ''},
        degree,
        experience,
        status
      ),
      submission:submissions(
        id,
        title,
        abstract,
        keywords_text,
        paper_type,
        status,
        created_at,
        author:authors(
          full_name,
          email,
          affiliation
        ),
        submission_files:submission_files(
          id,
          original_filename,
          mime_type,
          byte_size
        )
      )
    `;

    const fetchReview = async (includeExpertise = true) =>
      supabase
        .from('reviews')
        .select(buildSelect(includeExpertise))
        .eq('id', reviewId)
        .single();

    let { data: review, error } = await fetchReview(true);

    if (error && error.code === '42703') {
      console.warn('expertise_keywords_text column missing in reviewer_applications table, retrying without it.');
      ({ data: review, error } = await fetchReview(false));
      if (!error && review?.reviewer) {
        review = {
          ...review,
          reviewer: {
            ...review.reviewer,
            expertise_areas: []
          }
        };
      }
    }

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error(`Review with ID ${reviewId} not found`);
      }
      console.error('Error fetching review details:', error);
      throw error;
    }

    // Parse submission keywords
    let keywords = [];
    if (review.submission?.keywords_text) {
      try {
        keywords = JSON.parse(review.submission.keywords_text);
      } catch (e) {
        keywords = review.submission.keywords_text.split(',').map(k => k.trim());
      }
    }

    // Calculate review metrics
    const metrics = {
      assignment_to_start: review.started_at && review.assigned_at 
        ? Math.ceil((new Date(review.started_at) - new Date(review.assigned_at)) / (1000 * 60 * 60 * 24))
        : null,
      start_to_completion: review.completed_at && review.started_at
        ? Math.ceil((new Date(review.completed_at) - new Date(review.started_at)) / (1000 * 60 * 60 * 24))
        : null,
      total_review_time: review.completed_at && review.assigned_at
        ? Math.ceil((new Date(review.completed_at) - new Date(review.assigned_at)) / (1000 * 60 * 60 * 24))
        : null,
      days_until_due: review.due_date && review.status !== 'COMPLETED'
        ? Math.ceil((new Date(review.due_date) - new Date()) / (1000 * 60 * 60 * 24))
        : null
    };

    // Enhance review data
    const enhancedReview = {
      ...review,
      submission: {
        ...review.submission,
        keywords
      },
      metrics,
      status_history: [
        { status: 'PENDING', timestamp: review.assigned_at, description: 'Review assigned' },
        review.started_at ? { status: 'IN_PROGRESS', timestamp: review.started_at, description: 'Review started' } : null,
        review.completed_at ? { status: 'COMPLETED', timestamp: review.completed_at, description: 'Review completed' } : null
      ].filter(Boolean),
      reviewer_qualifications: {
        expertise_match: review.reviewer?.expertise_areas?.filter(area =>
          keywords.some(keyword => 
            area.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(area.toLowerCase())
          )
        ) || [],
        total_expertise_areas: review.reviewer?.expertise_areas?.length || 0,
        institution: review.reviewer?.institution,
        experience: review.reviewer?.experience
      }
    };

    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEW_VIEW,
      RESOURCE_TYPES.REVIEW,
      reviewId,
      { viewed_detailed: true }
    );

    return enhancedReview;
  } catch (err) {
    console.error('Error in getReviewDetailsForAdmin:', err);
    throw err;
  }
}

/**
 * Mark a review as completed (admin override)
 * @param {number} reviewId - Review ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} completionData - Completion details
 * @returns {Promise<Object>} - Updated review
 */
export async function completeReviewForAdmin(reviewId, adminEmail = 'admin@system', completionData = {}) {
  try {
    // Get current review state
    const { data: currentReview, error: fetchError } = await supabase
      .from('reviews')
      .select('*')
      .eq('id', reviewId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        throw new Error(`Review with ID ${reviewId} not found`);
      }
      throw fetchError;
    }

    if (currentReview.status === 'COMPLETED') {
      throw new Error('Review is already completed');
    }

    // Validate required data for completion
    if (completionData.score !== undefined && (completionData.score < 0 || completionData.score > 10)) {
      throw new Error('Score must be between 0 and 10');
    }

    // Update review to completed status
    const updateData = {
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
      score: completionData.score || null,
      comments: completionData.comments || currentReview.comments,
      feedback: completionData.feedback || currentReview.feedback,
      recommendation: completionData.recommendation || null,
      admin_completed: true,
      admin_completed_by: adminEmail,
      updated_at: new Date().toISOString()
    };

    // Set started_at if not already set
    if (!currentReview.started_at) {
      updateData.started_at = currentReview.assigned_at;
    }

    const { data: updatedReview, error: updateError } = await supabase
      .from('reviews')
      .update(updateData)
      .eq('id', reviewId)
      .select(`
        *,
        reviewer:reviewer_applications(full_name, applicant_email),
        submission:submissions(id, title, status)
      `)
      .single();

    if (updateError) {
      console.error('Error updating review:', updateError);
      throw updateError;
    }

    // Check if all reviews for the submission are completed
    const { data: allReviews, error: allReviewsError } = await supabase
      .from('reviews')
      .select('id, status')
      .eq('submission_id', currentReview.submission_id);

    if (!allReviewsError && allReviews) {
      const incompleteReviews = allReviews.filter(r => r.status !== 'COMPLETED');
      
      // If all reviews are completed, update submission status
      if (incompleteReviews.length === 0) {
        await supabase
          .from('submissions')
          .update({ 
            status: 'review_completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', currentReview.submission_id);
      }
    }

    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEW_COMPLETE,
      RESOURCE_TYPES.REVIEW,
      reviewId,
      {
        admin_override: true,
        score: completionData.score,
        has_comments: !!completionData.comments,
        has_feedback: !!completionData.feedback,
        recommendation: completionData.recommendation,
        previous_status: currentReview.status
      },
      currentReview,
      updatedReview
    );

    return updatedReview;
  } catch (err) {
    console.error('Error in completeReviewForAdmin:', err);
    throw err;
  }
}

/**
 * Send reminder to reviewer
 * @param {number} reviewId - Review ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} reminderData - Reminder details
 * @returns {Promise<Object>} - Updated review
 */
export async function sendReviewReminderForAdmin(reviewId, adminEmail = 'admin@system', reminderData = {}) {
  try {
    // Get current review state
    const { data: currentReview, error: fetchError } = await supabase
      .from('reviews')
      .select(`
        *,
        reviewer:reviewer_applications(full_name, applicant_email),
        submission:submissions(id, title, author:authors(full_name))
      `)
      .eq('id', reviewId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (currentReview.status === 'COMPLETED') {
      throw new Error('Cannot send reminder for completed review');
    }

    // Update reminder status
    const updateData = {
      reminder_sent: true,
      reminder_sent_at: new Date().toISOString(),
      reminder_count: (currentReview.reminder_count || 0) + 1,
      last_reminder_by: adminEmail,
      updated_at: new Date().toISOString()
    };

    const { data: updatedReview, error: updateError } = await supabase
      .from('reviews')
      .update(updateData)
      .eq('id', reviewId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEW_REMINDER_SENT,
      RESOURCE_TYPES.REVIEW,
      reviewId,
      {
        reminder_count: updateData.reminder_count,
        reviewer_email: currentReview.reviewer?.applicant_email,
        submission_title: currentReview.submission?.title,
        custom_message: reminderData.message || null
      }
    );

    // In a real application, you would send an email here
    // For now, we'll just return the updated review with a message
    return {
      ...updatedReview,
      reminder_sent_message: `Reminder sent to ${currentReview.reviewer?.full_name} (${currentReview.reviewer?.applicant_email})`
    };
  } catch (err) {
    console.error('Error in sendReviewReminderForAdmin:', err);
    throw err;
  }
}

/**
 * Reassign review to a different reviewer
 * @param {number} reviewId - Review ID
 * @param {string} newReviewerId - New reviewer ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} reassignmentData - Reassignment details
 * @returns {Promise<Object>} - Updated review
 */
export async function reassignReviewForAdmin(reviewId, newReviewerId, adminEmail = 'admin@system', reassignmentData = {}) {
  try {
    // Get current review state
    const { data: currentReview, error: fetchError } = await supabase
      .from('reviews')
      .select(`
        *,
        reviewer:reviewer_applications(full_name, applicant_email)
      `)
      .eq('id', reviewId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (currentReview.status === 'COMPLETED') {
      throw new Error('Cannot reassign completed review');
    }

    // Get new reviewer details
    const { data: newReviewer, error: reviewerError } = await supabase
      .from('reviewer_applications')
      .select('id, full_name, applicant_email, status')
      .eq('id', newReviewerId)
      .single();

    if (reviewerError || newReviewer.status !== 'APPROVED') {
      throw new Error('New reviewer not found or not approved');
    }

    // Update review assignment
    const updateData = {
      reviewer_id: newReviewerId,
      status: 'PENDING',
      assigned_at: new Date().toISOString(),
      reassigned_by: adminEmail,
      reassigned_at: new Date().toISOString(),
      reassignment_reason: reassignmentData.reason || null,
      previous_reviewer_id: currentReview.reviewer_id,
      started_at: null, // Reset start time
      reminder_sent: false,
      reminder_count: 0,
      due_date: reassignmentData.new_due_date || currentReview.due_date,
      updated_at: new Date().toISOString()
    };

    const { data: updatedReview, error: updateError } = await supabase
      .from('reviews')
      .update(updateData)
      .eq('id', reviewId)
      .select(`
        *,
        reviewer:reviewer_applications(full_name, applicant_email)
      `)
      .single();

    if (updateError) {
      throw updateError;
    }

    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEW_REASSIGN,
      RESOURCE_TYPES.REVIEW,
      reviewId,
      {
        previous_reviewer_id: currentReview.reviewer_id,
        previous_reviewer_email: currentReview.reviewer?.applicant_email,
        new_reviewer_id: newReviewerId,
        new_reviewer_email: newReviewer.applicant_email,
        reassignment_reason: reassignmentData.reason,
        new_due_date: reassignmentData.new_due_date
      },
      currentReview,
      updatedReview
    );

    return updatedReview;
  } catch (err) {
    console.error('Error in reassignReviewForAdmin:', err);
    throw err;
  }
}

/**
 * Get review statistics for admin dashboard
 * @returns {Promise<Object>} - Statistics object
 */
export async function getReviewStatistics(adminEmail = 'admin@system') {
  try {
    // Get all reviews
    const { data: allReviews } = await supabase
      .from('reviews')
      .select('status, assigned_at, completed_at, due_date, score');

    // Calculate statistics
    const now = new Date();
    const stats = {
      total_reviews: allReviews?.length || 0,
      completed_reviews: 0,
      pending_reviews: 0,
      in_progress_reviews: 0,
      overdue_reviews: 0,
      average_review_time: 0,
      average_score: 0,
      completion_rate: 0,
      on_time_completion_rate: 0
    };

    if (allReviews && allReviews.length > 0) {
      // Count by status
      allReviews.forEach(review => {
        switch (review.status) {
          case 'COMPLETED':
            stats.completed_reviews++;
            break;
          case 'PENDING':
            stats.pending_reviews++;
            break;
          case 'IN_PROGRESS':
            stats.in_progress_reviews++;
            break;
        }

        // Count overdue
        if (review.status !== 'COMPLETED' && review.due_date && new Date(review.due_date) < now) {
          stats.overdue_reviews++;
        }
      });

      // Calculate completion rate
      stats.completion_rate = Math.round((stats.completed_reviews / allReviews.length) * 100);

      // Calculate average review time for completed reviews
      const completedReviews = allReviews.filter(r => 
        r.status === 'COMPLETED' && r.assigned_at && r.completed_at
      );

      if (completedReviews.length > 0) {
        const totalDays = completedReviews.reduce((sum, review) => {
          const assignedDate = new Date(review.assigned_at);
          const completedDate = new Date(review.completed_at);
          return sum + Math.ceil((completedDate - assignedDate) / (1000 * 60 * 60 * 24));
        }, 0);
        stats.average_review_time = Math.round(totalDays / completedReviews.length);

        // Calculate on-time completion rate
        const onTimeReviews = completedReviews.filter(r => 
          r.due_date && new Date(r.completed_at) <= new Date(r.due_date)
        );
        stats.on_time_completion_rate = Math.round((onTimeReviews.length / completedReviews.length) * 100);
      }

      // Calculate average score
      const scoredReviews = allReviews.filter(r => r.score !== null);
      if (scoredReviews.length > 0) {
        const totalScore = scoredReviews.reduce((sum, r) => sum + r.score, 0);
        stats.average_score = Math.round((totalScore / scoredReviews.length) * 10) / 10;
      }
    }

    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEW_VIEW,
      RESOURCE_TYPES.REVIEW,
      'statistics',
      { stats }
    );

    return stats;
  } catch (err) {
    console.error('Error in getReviewStatistics:', err);
    throw err;
  }
}

/**
 * Get overdue reviews for admin attention
 * @returns {Promise<Array>} - Array of overdue reviews
 */
export async function getOverdueReviews(adminEmail = 'admin@system') {
  try {
    const now = new Date().toISOString();
    
    const { data: overdueReviews, error } = await supabase
      .from('reviews')
      .select(`
        *,
        reviewer:reviewer_applications(
          full_name,
          applicant_email,
          institution
        ),
        submission:submissions(
          id,
          title,
          paper_type,
          author:authors(full_name, email)
        )
      `)
      .neq('status', 'COMPLETED')
      .lt('due_date', now)
      .order('due_date', { ascending: true });

    if (error) {
      console.error('Error fetching overdue reviews:', error);
      throw error;
    }

    // Enhance with overdue metrics
    const enhancedOverdueReviews = overdueReviews?.map(review => {
      const dueDate = new Date(review.due_date);
      const currentDate = new Date();
      const overdueDays = Math.ceil((currentDate - dueDate) / (1000 * 60 * 60 * 24));

      return {
        ...review,
        overdue_days: overdueDays,
        severity: overdueDays > 14 ? 'critical' : overdueDays > 7 ? 'high' : 'medium'
      };
    }) || [];

    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEW_VIEW,
      RESOURCE_TYPES.REVIEW,
      'overdue_list',
      { count: enhancedOverdueReviews.length }
    );

    return enhancedOverdueReviews;
  } catch (err) {
    console.error('Error in getOverdueReviews:', err);
    throw err;
  }
}