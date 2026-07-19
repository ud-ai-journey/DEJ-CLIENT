import supabase from '../../config/supabase.js';
import { logAdminAction, ADMIN_ACTIONS, RESOURCE_TYPES, createAuditContext } from './admin-audit-service.js';

const SUBMISSION_ADMIN_SELECT = `
  *,
  author:authors(
    full_name,
    email,
    affiliation
  ),
  reviews:reviews(
    id,
    reviewer_id,
    status,
    score,
    completed_at,
    due_date,
    reviewer:reviewer_applications(
      full_name,
      applicant_email
    )
  ),
  submission_files:submission_files(
    id,
    original_filename,
    byte_size
  )
`;

/**
 * Enhanced admin submission management service with transaction support
 */

/**
 * Get enhanced submission details for admin
 * @param {number} submissionId - Submission ID
 * @param {string} adminEmail - Admin's email for audit logging
 * @returns {Promise<Object>} - Detailed submission data
 */
export async function getSubmissionDetailsForAdmin(submissionId, adminEmail) {
  try {
    const buildSelect = (includeExpertise = true) => `
      *,
      submission_files:submission_files(
        id,
        original_filename,
        mime_type,
        byte_size,
        storage_key,
        created_at
      ),
      reviews:reviews(
        id,
        reviewer_id,
        status,
        score,
        comments,
        feedback,
        assigned_at,
        started_at,
        completed_at,
        due_date,
        assigned_by,
        reminder_sent,
        reviewer:reviewer_applications(
          full_name,
          applicant_email,
          institution${includeExpertise ? ',\n          expertise_keywords_text' : ''}
        )
      )
    `;

    const fetchSubmission = async (includeExpertise = true) =>
      supabase
        .from('submissions')
        .select(buildSelect(includeExpertise))
        .eq('id', submissionId)
        .single();

    let { data: submission, error } = await fetchSubmission(true);

    if (error && error.code === '42703') {
      console.warn('expertise_keywords_text column missing in reviewer_applications table, retrying without it.');
      ({ data: submission, error } = await fetchSubmission(false));
      if (!error && submission?.reviews) {
        submission.reviews = submission.reviews.map(review => ({
          ...review,
          reviewer: {
            ...review.reviewer,
            expertise_areas: review.reviewer?.expertise_keywords_text ? 
              review.reviewer.expertise_keywords_text.split(',').map(area => area.trim()).filter(area => area) : []
          }
        }));
      }
    }

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error(`Submission with ID ${submissionId} not found`);
      }
      console.error('Error fetching submission details:', error);
      throw error;
    }

    // Fetch author data separately based on owner_email
    let authorData = null;
    if (submission.owner_email) {
      const { data: author, error: authorError } = await supabase
        .from('authors')
        .select('full_name, email, affiliation, location')
        .eq('email_lower', submission.owner_email.toLowerCase())
        .single();
      
      if (!authorError) {
        authorData = author;
      } else if (authorError.code !== 'PGRST116') {
        console.error('Error fetching author data:', authorError);
      }
    }

    // If no author found using owner_email, try first_author_email
    if (!authorData && submission.first_author_email) {
      const { data: author, error: authorError } = await supabase
        .from('authors')
        .select('full_name, email, affiliation, location')
        .eq('email_lower', submission.first_author_email.toLowerCase())
        .single();
      
      if (!authorError) {
        authorData = author;
      } else if (authorError.code !== 'PGRST116') {
        console.error('Error fetching first author data:', authorError);
      }
    }

    // If still no author found, create a minimal author object from submission data
    if (!authorData) {
      const email = submission.first_author_email || submission.owner_email;
      if (email) {
        authorData = {
          full_name: 'Unknown Author',
          email: email,
          affiliation: 'No affiliation',
          location: null
        };
      }
    }

    // Add author data to submission
    submission.author = authorData;

    // Parse keywords if stored as text
    let keywords = [];
    if (submission.keywords_text) {
      try {
        keywords = JSON.parse(submission.keywords_text);
      } catch (e) {
        keywords = submission.keywords_text.split(',').map(k => k.trim());
      }
    }

    // Parse coauthor emails
    let coauthors = [];
    if (submission.coauthor_emails) {
      coauthors = Array.isArray(submission.coauthor_emails) 
        ? submission.coauthor_emails 
        : JSON.parse(submission.coauthor_emails);
    }

    // Calculate review statistics
    const reviewStats = {
      total_reviewers: submission.reviews?.length || 0,
      completed_reviews: submission.reviews?.filter(r => r.status === 'COMPLETED').length || 0,
      pending_reviews: submission.reviews?.filter(r => r.status === 'PENDING').length || 0,
      in_progress_reviews: submission.reviews?.filter(r => r.status === 'IN_PROGRESS').length || 0,
      average_score: 0,
      overdue_reviews: 0
    };

    if (submission.reviews) {
      const scores = submission.reviews
        .filter(r => r.score !== null)
        .map(r => r.score);
      
      if (scores.length > 0) {
        reviewStats.average_score = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
      }

      // Count overdue reviews
      const now = new Date();
      reviewStats.overdue_reviews = submission.reviews.filter(r => 
        r.status !== 'COMPLETED' && r.due_date && new Date(r.due_date) < now
      ).length;
    }

    const enhancedSubmission = {
      ...submission,
      keywords,
      coauthors,
      review_statistics: reviewStats,
      processing_timeline: {
        submitted: submission.created_at,
        verified: submission.is_verified ? submission.verified_at : null,
        under_review: submission.reviews?.find(r => r.status !== 'PENDING')?.assigned_at || null,
        published: submission.published_at
      },
      // Flatten author data for frontend compatibility
      author_name: authorData?.full_name || 'Unknown',
      author_email: authorData?.email || '',
      affiliation: authorData?.affiliation || '',
      // Add download count (placeholder for now)
      download_count: 0
    };

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.SUBMISSION_VIEW,
      RESOURCE_TYPES.SUBMISSION,
      submissionId,
      { viewed_detailed: true }
    );

    return enhancedSubmission;
  } catch (err) {
    console.error('Error in getSubmissionDetailsForAdmin:', err);
    throw err;
  }
}

/**
 * Verify a submission (admin only) with transaction support
 * @param {number} submissionId - Submission ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} verificationData - Verification details
 * @returns {Promise<Object>} - Updated submission
 */
export async function verifySubmissionForAdmin(submissionId, adminEmail, verificationData = {}) {
  try {
    // Get current submission state
    const { data: currentSubmission, error: fetchError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (currentSubmission.is_verified) {
      // Return the already verified submission instead of throwing an error
      console.log(`Submission ${submissionId} is already verified, returning existing state`);
      return currentSubmission;
    }

    // Update submission to verified status
    const updateData = {
      is_verified: true,
      verified_by: adminEmail,
      verified_at: new Date().toISOString(),
      status: 'verified',
      updated_at: new Date().toISOString(),
      ...verificationData
    };

    const { data: updatedSubmission, error: updateError } = await supabase
      .from('submissions')
      .update(updateData)
      .eq('id', submissionId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.SUBMISSION_VERIFY,
      RESOURCE_TYPES.SUBMISSION,
      submissionId,
      { 
        verification_notes: verificationData.notes || null,
        previous_status: currentSubmission.status 
      },
      currentSubmission,
      updatedSubmission
    );

    return updatedSubmission;
  } catch (err) {
    console.error('Error in verifySubmissionForAdmin:', err);
    throw err;
  }
}

/**
 * Assign reviewer to submission with due date
 * @param {number} submissionId - Submission ID
 * @param {string} reviewerId - Reviewer ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} assignmentData - Assignment details including due date
 * @returns {Promise<Object>} - Created review assignment
 */
export async function assignReviewerToSubmission(submissionId, reviewerId, adminEmail, assignmentData = {}) {
  try {
    // Get submission details first
    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select('id, title, status')
      .eq('id', submissionId)
      .single();

    if (submissionError) {
      throw submissionError;
    }

    // Get reviewer details
    const { data: reviewer, error: reviewerError } = await supabase
      .from('reviewer_applications')
      .select('id, full_name, applicant_email, status')
      .eq('id', reviewerId)
      .single();

    if (reviewerError) {
      throw reviewerError;
    }

    if (!reviewer.status || reviewer.status.toUpperCase() !== 'APPROVED') {
      throw new Error('Reviewer must be approved before assignment');
    }

    // Check for existing review assignment
    const { data: existingReview, error: checkError } = await supabase
      .from('reviews')
      .select('id, status')
      .eq('submission_id', submissionId)
      .eq('reviewer_id', reviewerId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is what we want
      throw checkError;
    }

    if (existingReview) {
      throw new Error(`This reviewer is already assigned to this submission with status: ${existingReview.status}`);
    }

    // Calculate due date (default 14 days from now if not provided)
    const dueDate = assignmentData.due_date || 
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Create review assignment
    const reviewData = {
      submission_id: submissionId,
      reviewer_id: reviewerId,
      status: 'PENDING',
      assigned_at: new Date().toISOString(),
      due_date: dueDate,
      assigned_by: adminEmail,
      reminder_sent: false
    };

    const { data: review, error: reviewCreateError } = await supabase
      .from('reviews')
      .insert(reviewData)
      .select(`
        *,
        reviewer:reviewer_applications(full_name, applicant_email),
        submission:submissions(title, status)
      `)
      .single();

    if (reviewCreateError) {
      // Handle unique constraint violation specifically
      if (reviewCreateError.code === '23505' && reviewCreateError.message.includes('reviews_submission_reviewer_unique')) {
        throw new Error('This reviewer is already assigned to this submission');
      }
      throw reviewCreateError;
    }

    // Update submission status to under_review if it's not already
    if (submission.status === 'submitted' || submission.status === 'verified') {
      await supabase
        .from('submissions')
        .update({ 
          status: 'under_review',
          updated_at: new Date().toISOString()
        })
        .eq('id', submissionId);
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.SUBMISSION_ASSIGN_REVIEWER,
      RESOURCE_TYPES.SUBMISSION,
      submissionId,
      {
        reviewer_id: reviewerId,
        reviewer_name: reviewer.full_name,
        reviewer_email: reviewer.applicant_email,
        due_date: dueDate,
        assignment_notes: assignmentData.notes || null
      }
    );

    return review;
  } catch (err) {
    console.error('Error in assignReviewerToSubmission:', err);
    throw err;
  }
}

/**
 * Publish a submission (admin only)
 * @param {number} submissionId - Submission ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} publishData - Publication details
 * @returns {Promise<Object>} - Updated submission
 */
export async function publishSubmissionForAdmin(submissionId, adminEmail, publishData = {}) {
  try {
    // Get current submission state
    const { data: currentSubmission, error: fetchError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (currentSubmission.status !== 'accepted') {
      throw new Error('Submission must be accepted before publishing');
    }

    if (currentSubmission.published_at) {
      throw new Error('Submission is already published');
    }

    // Update submission to published status
    const updateData = {
      status: 'published',
      published_at: new Date().toISOString(),
      published_by: adminEmail,
      publication_url: publishData.publication_url || null,
      doi: publishData.doi || null,
      volume: publishData.volume || null,
      issue: publishData.issue || null,
      pages: publishData.pages || null,
      updated_at: new Date().toISOString()
    };

    const { data: updatedSubmission, error: updateError } = await supabase
      .from('submissions')
      .update(updateData)
      .eq('id', submissionId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.SUBMISSION_PUBLISH,
      RESOURCE_TYPES.SUBMISSION,
      submissionId,
      {
        publication_url: publishData.publication_url,
        doi: publishData.doi,
        publication_details: publishData,
        previous_status: currentSubmission.status
      },
      currentSubmission,
      updatedSubmission
    );

    return updatedSubmission;
  } catch (err) {
    console.error('Error in publishSubmissionForAdmin:', err);
    throw err;
  }
}

/**
 * Request revision for a submission
 * @param {number} submissionId - Submission ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} revisionData - Revision request details
 * @returns {Promise<Object>} - Updated submission
 */
export async function requestRevisionForSubmission(submissionId, adminEmail, revisionData = {}) {
  try {
    // Get current submission state
    const { data: currentSubmission, error: fetchError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    // Determine revision type (minor or major)
    const revisionType = revisionData.revision_type === 'major' ? 'major_revision' : 'minor_revision';

    // Update submission status
    const updateData = {
      status: revisionType,
      revision_requested_at: new Date().toISOString(),
      revision_requested_by: adminEmail,
      revision_comments: revisionData.comments || null,
      revision_deadline: revisionData.deadline || null,
      updated_at: new Date().toISOString()
    };

    const { data: updatedSubmission, error: updateError } = await supabase
      .from('submissions')
      .update(updateData)
      .eq('id', submissionId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.SUBMISSION_REQUEST_REVISION,
      RESOURCE_TYPES.SUBMISSION,
      submissionId,
      {
        revision_type: revisionType,
        comments: revisionData.comments,
        deadline: revisionData.deadline,
        previous_status: currentSubmission.status
      },
      currentSubmission,
      updatedSubmission
    );

    return updatedSubmission;
  } catch (err) {
    console.error('Error in requestRevisionForSubmission:', err);
    throw err;
  }
}

/**
 * Get enhanced submissions list for admin with better filtering
 * @param {Object} filters - Filter criteria
 * @param {number} limit - Number of records to return
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Object>} - Paginated submissions with enhanced data
 */
export async function getSubmissionsForAdmin(filters = {}, limit = 20, offset = 0, adminEmail = 'admin@system') {
  try {
    const applyFilters = (queryBuilder) => {
      let builder = queryBuilder;

      if (filters.status) {
        if (Array.isArray(filters.status)) {
          builder = builder.in('status', filters.status);
        } else {
          builder = builder.eq('status', filters.status);
        }
      }

      if (filters.paper_type) {
        builder = builder.eq('paper_type', filters.paper_type);
      }

      if (filters.is_verified !== undefined) {
        builder = builder.eq('is_verified', filters.is_verified);
      }

      if (filters.author_email) {
        builder = builder.ilike('owner_email', `%${filters.author_email}%`);
      }

      if (filters.title) {
        builder = builder.ilike('title', `%${filters.title}%`);
      }

      if (filters.reviewer_id) {
        builder = builder.eq('reviews.reviewer_id', filters.reviewer_id);
      }

      if (typeof filters.search === 'string' && filters.search.trim()) {
        const searchTerm = `%${filters.search.trim()}%`;
        builder = builder.or(
          `title.ilike.${searchTerm},abstract.ilike.${searchTerm},keywords_text.ilike.${searchTerm},owner_email.ilike.${searchTerm}`
        );
      }

      if (filters.created_after) {
        builder = builder.gte('created_at', filters.created_after);
      }

      if (filters.created_before) {
        builder = builder.lte('created_at', filters.created_before);
      }

      if (filters.has_reviewers !== undefined) {
        if (filters.has_reviewers) {
          builder = builder.not('reviews', 'is', null);
        } else {
          builder = builder.is('reviews', null);
        }
      }

      return builder;
    };

    let query = supabase
      .from('submissions')
      .select(SUBMISSION_ADMIN_SELECT);

    query = applyFilters(query);

    let orderColumn = 'published_at';
    let orderAscending = false;

    switch (filters.sort_by) {
      case 'published_at_asc':
        orderColumn = 'published_at';
        orderAscending = true;
        break;
      case 'published_at_desc':
        orderColumn = 'published_at';
        orderAscending = false;
        break;
      case 'title_asc':
        orderColumn = 'title';
        orderAscending = true;
        break;
      case 'title_desc':
        orderColumn = 'title';
        orderAscending = false;
        break;
      case 'author_asc':
        orderColumn = 'author.full_name';
        orderAscending = true;
        break;
      default:
        // Default to latest published first
        orderColumn = 'published_at';
        orderAscending = false;
        break;
    }

    query = query.order(orderColumn, { ascending: orderAscending }).range(offset, offset + limit - 1);

    // Apply filters
    const { data, error } = await query;

    if (error) {
      console.error('Error fetching submissions for admin:', error);
      throw error;
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('submissions')
      .select(SUBMISSION_ADMIN_SELECT, { count: 'exact', head: true });

    countQuery = applyFilters(countQuery);

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error('Error counting submissions for admin:', countError);
      throw countError;
    }

    // Enhance submissions with additional metadata
    const enhancedSubmissions = data?.map(submission => {
      // Parse keywords
      let keywords = [];
      if (submission.keywords_text) {
        try {
          keywords = JSON.parse(submission.keywords_text);
        } catch (e) {
          keywords = submission.keywords_text.split(',').map(k => k.trim());
        }
      }

      // Calculate review progress
      const reviewProgress = {
        total: submission.reviews?.length || 0,
        completed: submission.reviews?.filter(r => r.status === 'COMPLETED').length || 0,
        pending: submission.reviews?.filter(r => r.status === 'PENDING').length || 0,
        overdue: submission.reviews?.filter(r => 
          r.status !== 'COMPLETED' && r.due_date && new Date(r.due_date) < new Date()
        ).length || 0
      };

      // Flatten author data for frontend compatibility
      const author_name = submission.author?.full_name || 'Unknown';
      const author_email = submission.author?.email || '';
      const affiliation = submission.author?.affiliation || '';

      return {
        ...submission,
        keywords,
        review_progress: reviewProgress,
        days_since_submission: Math.floor(
          (new Date() - new Date(submission.created_at)) / (1000 * 60 * 60 * 24)
        ),
        file_count: submission.submission_files?.length || 0,
        total_file_size: submission.submission_files?.reduce(
          (total, file) => total + (file.byte_size || 0), 0
        ) || 0,
        // Flatten author data
        author_name,
        author_email,
        affiliation,
        // Add download count (placeholder for now)
        download_count: 0
      };
    }) || [];

    const result = {
      data: enhancedSubmissions,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (offset + limit) < (totalCount || 0)
      },
      filters_applied: filters
    };

    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.SUBMISSION_VIEW,
      RESOURCE_TYPES.SUBMISSION,
      'list',
      { filters }
    );

    return result;
  } catch (err) {
    console.error('Error in getSubmissionsForAdmin:', err);
    throw err;
  }
}

/**
 * Reject a submission
 * @param {number} submissionId - Submission ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} rejectionData - Rejection details
 * @returns {Promise<Object>} - Updated submission
 */
export async function rejectSubmissionForAdmin(submissionId, adminEmail, rejectionData = {}) {
  try {
    // Get current submission state
    const { data: currentSubmission, error: fetchError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (currentSubmission.status === 'rejected') {
      throw new Error('Submission is already rejected');
    }

    // Update submission to rejected status
    const updateData = {
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejected_by: adminEmail,
      rejection_comments: rejectionData.comments || null,
      updated_at: new Date().toISOString()
    };

    const { data: updatedSubmission, error: updateError } = await supabase
      .from('submissions')
      .update(updateData)
      .eq('id', submissionId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.SUBMISSION_REJECT,
      RESOURCE_TYPES.SUBMISSION,
      submissionId,
      {
        rejection_comments: rejectionData.comments,
        previous_status: currentSubmission.status
      },
      currentSubmission,
      updatedSubmission
    );

    return updatedSubmission;
  } catch (err) {
    console.error('Error in rejectSubmissionForAdmin:', err);
    throw err;
  }
}

/**
 * Get submission statistics for admin dashboard
 * @param {number} days - Number of days to look back
 * @returns {Promise<Object>} - Statistics object
 */
export async function getSubmissionStatistics(days = 30) {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get all submissions data
    const { data: allSubmissions } = await supabase
      .from('submissions')
      .select('status, created_at, is_verified, published_at');

    // Get recent submissions
    const { data: recentSubmissions } = await supabase
      .from('submissions')
      .select('status, created_at')
      .gte('created_at', since.toISOString());

    const stats = {
      total_submissions: allSubmissions?.length || 0,
      recent_submissions: recentSubmissions?.length || 0,
      by_status: {},
      verified_count: 0,
      published_count: 0,
      processing_times: {},
      trends: {}
    };

    // Calculate statistics
    allSubmissions?.forEach(submission => {
      stats.by_status[submission.status] = (stats.by_status[submission.status] || 0) + 1;
      
      if (submission.is_verified) stats.verified_count++;
      if (submission.published_at) stats.published_count++;
    });

    // Calculate recent trends
    const statusTrends = {};
    recentSubmissions?.forEach(submission => {
      statusTrends[submission.status] = (statusTrends[submission.status] || 0) + 1;
    });
    
    stats.trends = statusTrends;

    return stats;
  } catch (err) {
    console.error('Error in getSubmissionStatistics:', err);
    throw err;
  }
}

/**
 * Manually mark submission as review completed (admin override)
 * @param {string} submissionId - Submission ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} overrideData - Override details
 * @returns {Promise<Object>} - Updated submission
 */
export async function markReviewCompletedForAdmin(submissionId, adminEmail, overrideData = {}) {
  try {
    // Get current submission state
    const { data: currentSubmission, error: fetchError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (currentSubmission.status === 'review_completed') {
      throw new Error('Submission is already marked as review completed');
    }

    // Check if submission has at least one completed review
    const { data: reviews, error: reviewsError } = await supabase
      .from('reviews')
      .select('id, status')
      .eq('submission_id', submissionId);

    if (reviewsError) {
      throw reviewsError;
    }

    const completedReviews = reviews?.filter(r => r.status === 'COMPLETED') || [];

    if (completedReviews.length === 0) {
      throw new Error('Cannot mark as review completed: no reviews have been completed yet');
    }

    // Update submission to review_completed status
    const updateData = {
      status: 'review_completed',
      review_completed_by: adminEmail,
      review_completed_at: new Date().toISOString(),
      review_completed_override: true,
      review_completed_reason: overrideData.reason || 'Admin override with partial reviews',
      updated_at: new Date().toISOString()
    };

    const { data: updatedSubmission, error: updateError } = await supabase
      .from('submissions')
      .update(updateData)
      .eq('id', submissionId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.SUBMISSION_MARK_REVIEW_COMPLETED,
      RESOURCE_TYPES.SUBMISSION,
      submissionId,
      {
        completed_reviews_count: completedReviews.length,
        total_reviews_count: reviews?.length || 0,
        override_reason: overrideData.reason,
        previous_status: currentSubmission.status
      },
      currentSubmission,
      updatedSubmission
    );

    return updatedSubmission;
  } catch (err) {
    console.error('Error in markReviewCompletedForAdmin:', err);
    throw err;
  }
}