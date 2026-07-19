import supabase from '../../config/supabase.js';
import { logAdminAction, ADMIN_ACTIONS, RESOURCE_TYPES } from './admin-audit-service.js';

let reviewerExpertiseAvailability = null;

async function isReviewerExpertiseAvailable() {
  if (reviewerExpertiseAvailability !== null) {
    return reviewerExpertiseAvailability;
  }

  const { error } = await supabase
    .from('reviewer_applications')
    .select('expertise_keywords_text')
    .limit(1);

  if (error) {
    if (error.code === '42703') {
      console.warn('reviewer_applications.expertise_keywords_text column missing; disabling expertise-dependent features.');
      reviewerExpertiseAvailability = false;
      return reviewerExpertiseAvailability;
    }
    throw error;
  }

  reviewerExpertiseAvailability = true;
  return reviewerExpertiseAvailability;
}

/**
 * Enhanced admin reviewer management service
 */

async function fetchReviewerApplication(identifier, selectClause = '*') {
  const trimmedIdentifier = identifier?.trim();

  if (!trimmedIdentifier) {
    throw new Error('Reviewer identifier is required');
  }

  const normalizedEmail = trimmedIdentifier.toLowerCase();

  // Prefer lookup by email
  let { data, error } = await supabase
    .from('reviewer_applications')
    .select(selectClause)
    .eq('applicant_email_lower', normalizedEmail)
    .single();

  if (!error) {
    return {
      reviewer: data,
      normalizedEmail: data?.applicant_email_lower || normalizedEmail,
      resolvedBy: 'email'
    };
  }

  if (error && error.code && error.code !== 'PGRST116') {
    throw error;
  }

  if (trimmedIdentifier.includes('@')) {
    const notFoundError = new Error(`Reviewer with email ${trimmedIdentifier} not found`);
    notFoundError.code = 'PGRST116';
    throw notFoundError;
  }

  // Legacy fallback: lookup by ID
  ({ data, error } = await supabase
    .from('reviewer_applications')
    .select(selectClause)
    .eq('id', trimmedIdentifier)
    .single());

  if (error) {
    if (error.code === 'PGRST116') {
      const notFoundError = new Error(`Reviewer with identifier ${trimmedIdentifier} not found`);
      notFoundError.code = 'PGRST116';
      throw notFoundError;
    }
    throw error;
  }

  return {
    reviewer: data,
    normalizedEmail: data?.applicant_email_lower || normalizedEmail,
    resolvedBy: 'id'
  };
}

/**
 * Get reviewers with advanced filtering and status management
 * @param {Object} filters - Filter criteria
 * @param {number} limit - Number of records to return  
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Object>} - Paginated reviewers list with metadata
 */
export async function getReviewersForAdmin(filters = {}, limit = 20, offset = 0, adminEmail = 'admin@system') {
  try {
    let query = supabase
      .from('reviewer_applications')
      .select(`
        *,
        reviews:reviews(
          id,
          submission_id,
          status,
          score,
          completed_at,
          due_date,
          submission:submissions(
            id,
            title,
            status
          )
        ),
        account:account_emails(
          email,
          created_at,
          auth_user_id
        )
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status);
      } else {
        query = query.eq('status', filters.status);
      }
    }

    if (filters.search) {
      const searchTerm = `%${filters.search.toLowerCase()}%`;
      query = query.or(`full_name.ilike.${searchTerm},applicant_email.ilike.${searchTerm},institution.ilike.${searchTerm}`);
    }

    if (filters.institution) {
      query = query.ilike('institution', `%${filters.institution}%`);
    }

    if (filters.expertise_area) {
      const expertiseAvailable = await isReviewerExpertiseAvailable();
      if (expertiseAvailable) {
        query = query.ilike('expertise_keywords_text', `%${filters.expertise_area}%`);
      } else {
        console.warn('Expertise filter requested but expertise_keywords_text column is unavailable; ignoring filter.');
      }
    }

    if (filters.has_reviews !== undefined) {
      if (filters.has_reviews) {
        query = query.not('reviews', 'is', null);
      } else {
        query = query.is('reviews', null);
      }
    }

    if (filters.created_after) {
      query = query.gte('created_at', filters.created_after);
    }

    if (filters.created_before) {
      query = query.lte('created_at', filters.created_before);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching reviewers for admin:', error);
      throw error;
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('reviewer_applications')
      .select('*', { count: 'exact', head: true });

    // Apply same filters to count query
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        countQuery = countQuery.in('status', filters.status);
      } else {
        countQuery = countQuery.eq('status', filters.status);
      }
    }

    const { count: totalCount } = await countQuery;

    // Enhance data with review statistics
    const enhancedData = data?.map(reviewer => {
      const reviewStats = {
        total_reviews: reviewer.reviews?.length || 0,
        completed_reviews: reviewer.reviews?.filter(r => r.status === 'COMPLETED').length || 0,
        pending_reviews: reviewer.reviews?.filter(r => r.status === 'PENDING').length || 0,
        in_progress_reviews: reviewer.reviews?.filter(r => r.status === 'IN_PROGRESS').length || 0,
        average_score: 0,
        overdue_reviews: 0
      };

      // Calculate average score
      if (reviewer.reviews) {
        const scores = reviewer.reviews
          .filter(r => r.score !== null)
          .map(r => r.score);
        
        if (scores.length > 0) {
          reviewStats.average_score = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
        }

        // Count overdue reviews
        const now = new Date();
        reviewStats.overdue_reviews = reviewer.reviews.filter(r => 
          r.status !== 'COMPLETED' && r.due_date && new Date(r.due_date) < now
        ).length;
      }

      return {
        ...reviewer,
        review_statistics: reviewStats,
        expertise_areas: reviewer.expertise_keywords_text ? 
          reviewer.expertise_keywords_text.split(',').map(area => area.trim()).filter(area => area) : [],
        is_active: reviewer.status === 'APPROVED',
        last_activity: reviewer.reviews?.reduce((latest, current) => 
          new Date(current.completed_at || current.assigned_at || 0) > new Date(latest || 0) 
            ? (current.completed_at || current.assigned_at) 
            : latest
        , null)
      };
    }) || [];

    const result = {
      data: enhancedData,
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
      ADMIN_ACTIONS.REVIEWER_VIEW,
      RESOURCE_TYPES.REVIEWER,
      'list',
      { filters }
    );

    return result;
  } catch (err) {
    console.error('Error in getReviewersForAdmin:', err);
    throw err;
  }
}

/**
 * Get detailed reviewer profile for admin
 * @param {string} reviewerIdentifier - Reviewer email (preferred) or legacy ID
 * @param {string} adminEmail - Admin's email for audit logging
 * @returns {Promise<Object>} - Detailed reviewer profile
 */
export async function getReviewerProfileForAdmin(reviewerIdentifier, adminEmail) {
  try {
    const buildSelect = (includeExpertise = true, includeMetadata = true) => `
        *,
        reviews:reviews(
          id,
          submission_id,
          status,
          score,
          comments,
          feedback,
          assigned_at,
          started_at,
          completed_at,
          due_date,
          reminder_sent,
          submission:submissions(
            id,
            title,
            abstract,
            paper_type,
            status,
            created_at,
            author:authors(full_name, email)
          )
        ),
        account:account_emails(
          email,
          created_at,
          auth_user_id${includeMetadata ? ',\n          metadata' : ''}
        )
      `;

    const state = {
      includeExpertise: await isReviewerExpertiseAvailable(),
      includeMetadata: true
    };

    const fetchWithFallbacks = async () => {
      try {
        return await fetchReviewerApplication(
          reviewerIdentifier,
          buildSelect(state.includeExpertise, state.includeMetadata)
        );
      } catch (error) {
        if (error.code === '42703') {
          const message = error.message || '';
          if (state.includeMetadata && message.includes('metadata')) {
            console.warn('account_emails.metadata column missing, retrying without it.');
            state.includeMetadata = false;
            return fetchWithFallbacks();
          }
          if (state.includeExpertise && message.includes('expertise_keywords_text')) {
            console.warn('reviewer_applications.expertise_keywords_text column missing, retrying without it.');
            state.includeExpertise = false;
            return fetchWithFallbacks();
          }
        }
        throw error;
      }
    };

    const { reviewer: rawReviewer, normalizedEmail } = await fetchWithFallbacks();

    const reviewer = {
      ...rawReviewer,
      expertise_areas: state.includeExpertise && rawReviewer.expertise_keywords_text ? 
        rawReviewer.expertise_keywords_text.split(',').map(area => area.trim()).filter(area => area) : []
    };

    // Calculate detailed statistics
    const statistics = {
      total_reviews: reviewer.reviews?.length || 0,
      completed_reviews: reviewer.reviews?.filter(r => r.status === 'COMPLETED').length || 0,
      pending_reviews: reviewer.reviews?.filter(r => r.status === 'PENDING').length || 0,
      in_progress_reviews: reviewer.reviews?.filter(r => r.status === 'IN_PROGRESS').length || 0,
      declined_reviews: reviewer.reviews?.filter(r => r.status === 'DECLINED').length || 0,
      average_review_time: 0,
      average_score: 0,
      completion_rate: 0,
      overdue_count: 0
    };

    if (reviewer.reviews && reviewer.reviews.length > 0) {
      // Calculate completion rate
      statistics.completion_rate = Math.round(
        (statistics.completed_reviews / reviewer.reviews.length) * 100
      );

      // Calculate average review time (days)
      const completedReviews = reviewer.reviews.filter(r => 
        r.status === 'COMPLETED' && r.assigned_at && r.completed_at
      );

      if (completedReviews.length > 0) {
        const totalDays = completedReviews.reduce((sum, review) => {
          const assignedDate = new Date(review.assigned_at);
          const completedDate = new Date(review.completed_at);
          const days = Math.ceil((completedDate - assignedDate) / (1000 * 60 * 60 * 24));
          return sum + days;
        }, 0);
        statistics.average_review_time = Math.round(totalDays / completedReviews.length);
      }

      // Calculate average score
      const scores = reviewer.reviews
        .filter(r => r.score !== null)
        .map(r => r.score);
      
      if (scores.length > 0) {
        statistics.average_score = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
      }

      // Count overdue reviews
      const now = new Date();
      statistics.overdue_count = reviewer.reviews.filter(r => 
        r.status !== 'COMPLETED' && r.due_date && new Date(r.due_date) < now
      ).length;
    }

    // Group reviews by status and paper type
    const reviewsByStatus = {};
    const reviewsByPaperType = {};
    
    reviewer.reviews?.forEach(review => {
      reviewsByStatus[review.status] = (reviewsByStatus[review.status] || 0) + 1;
      if (review.submission?.paper_type) {
        reviewsByPaperType[review.submission.paper_type] = 
          (reviewsByPaperType[review.submission.paper_type] || 0) + 1;
      }
    });

    // Get collaboration statistics (co-authors and shared submissions)
    const { data: collaborations } = await supabase
      .from('submissions')
      .select('coauthor_emails, first_author_email')
      .or(`owner_email_lower.eq.${normalizedEmail},first_author_email_lower.eq.${normalizedEmail}`)
      .not('coauthor_emails', 'is', null);

    const uniqueCollaborators = new Set();
    collaborations?.forEach(collab => {
      if (collab.coauthor_emails) {
        collab.coauthor_emails.forEach(email => {
          if (email.toLowerCase() !== normalizedEmail) {
            uniqueCollaborators.add(email.toLowerCase());
          }
        });
      }
    });

    const profile = {
      ...reviewer,
      expertise_areas: reviewer.expertise_areas || [],
      statistics,
      reviews_by_status: reviewsByStatus,
      reviews_by_paper_type: reviewsByPaperType,
      recent_reviews: reviewer.reviews?.slice(0, 5) || [],
      performance_metrics: {
        reliability_score: statistics.completion_rate,
        timeliness_score: statistics.overdue_count === 0 ? 100 : 
          Math.max(0, 100 - (statistics.overdue_count * 20)),
        quality_score: statistics.average_score > 0 ? statistics.average_score * 10 : null
      },
      collaboration_stats: {
        collaboration_count: uniqueCollaborators.size,
        collaborators: Array.from(uniqueCollaborators)
      },
      account_info: {
        member_since: reviewer.created_at,
        last_activity: reviewer.reviews?.reduce((latest, current) => {
          const candidate = current.completed_at || current.assigned_at;
          return new Date(candidate || 0) > new Date(latest || 0) ? candidate : latest;
        }, null)
      }
    };

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEWER_VIEW,
      RESOURCE_TYPES.REVIEWER,
      reviewer.id,
      {
        viewed_profile: true,
        reviewer_email: reviewer.applicant_email,
        lookup_identifier: reviewerIdentifier,
        normalized_lookup: normalizedEmail
      }
    );

    return profile;
  } catch (err) {
    console.error('Error in getReviewerProfileForAdmin:', err);
    throw err;
  }
}

/**
 * Verify/approve a reviewer application
 * @param {string} reviewerIdentifier - Reviewer email (preferred) or legacy ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} verificationData - Verification details
 * @returns {Promise<Object>} - Updated reviewer application
 */
export async function verifyReviewerForAdmin(reviewerIdentifier, adminEmail, verificationData = {}) {
  try {
    // Get current reviewer application (preferring email lookup but supporting ID fallback)
    const { reviewer: currentReviewer, normalizedEmail } = await fetchReviewerApplication(reviewerIdentifier, '*');

    if (currentReviewer.status === 'APPROVED') {
      throw new Error('Reviewer is already approved');
    }

    const sanitizedVerification = {
      notes: typeof verificationData?.notes === 'string'
        ? verificationData.notes.trim() || null
        : null
    };

    // Update reviewer status to approved
    const updateData = {
      status: 'APPROVED',
      approved_by: adminEmail,
      approved_at: new Date().toISOString(),
      verification_notes: sanitizedVerification.notes,
      updated_at: new Date().toISOString()
    };

    const { data: updatedReviewer, error: updateError } = await supabase
      .from('reviewer_applications')
      .update(updateData)
      .eq('applicant_email_lower', normalizedEmail)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating reviewer status:', updateError);
      throw updateError;
    }

    // Update account role to include reviewer if account exists
    if (currentReviewer.applicant_email) {
      await supabase
        .from('account_emails')
        .update({ 
          role: 'reviewer',
          updated_at: new Date().toISOString()
        })
        .eq('email_lower', normalizedEmail);
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEWER_VERIFY,
      RESOURCE_TYPES.REVIEWER,
      currentReviewer.id,
      {
        previous_status: currentReviewer.status,
        verification_notes: sanitizedVerification.notes,
        reviewer_email: currentReviewer.applicant_email,
        lookup_identifier: reviewerIdentifier
      },
      currentReviewer,
      updatedReviewer
    );

    return updatedReviewer;
  } catch (err) {
    console.error('Error in verifyReviewerForAdmin:', err);
    throw err;
  }
}

/**
 * Reject a reviewer application
 * @param {string} reviewerIdentifier - Reviewer email (preferred) or legacy ID
 * @param {string} adminEmail - Admin's email
 * @param {Object} rejectionData - Rejection details
 * @returns {Promise<Object>} - Updated reviewer application
 */
export async function rejectReviewerForAdmin(reviewerIdentifier, adminEmail, rejectionData = {}) {
  try {
    // Get current reviewer application (email-first lookup)
    const { reviewer: currentReviewer, normalizedEmail } = await fetchReviewerApplication(reviewerIdentifier, '*');

    const sanitizedRejection = {
      reason: typeof rejectionData?.reason === 'string'
        ? rejectionData.reason.trim() || null
        : null,
      notes: typeof rejectionData?.notes === 'string'
        ? rejectionData.notes.trim() || null
        : null
    };

    if (!sanitizedRejection.reason) {
      throw new Error('Rejection reason is required');
    }

    // Update reviewer status to rejected
    const updateData = {
      status: 'REJECTED',
      rejected_by: adminEmail,
      rejected_at: new Date().toISOString(),
      rejection_reason: sanitizedRejection.reason,
      rejection_notes: sanitizedRejection.notes,
      updated_at: new Date().toISOString()
    };

    const { data: updatedReviewer, error: updateError } = await supabase
      .from('reviewer_applications')
      .update(updateData)
      .eq('applicant_email_lower', normalizedEmail)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.REVIEWER_REJECT,
      RESOURCE_TYPES.REVIEWER,
      currentReviewer.id,
      {
        previous_status: currentReviewer.status,
        rejection_reason: sanitizedRejection.reason,
        rejection_notes: sanitizedRejection.notes,
        reviewer_email: currentReviewer.applicant_email,
        lookup_identifier: reviewerIdentifier
      },
      currentReviewer,
      updatedReviewer
    );

    return updatedReviewer;
  } catch (err) {
    console.error('Error in rejectReviewerForAdmin:', err);
    throw err;
  }
}

/**
 * Get reviewer statistics for admin dashboard
 * @returns {Promise<Object>} - Statistics object
 */
export async function getReviewerStatistics() {
  try {
    const includeExpertise = await isReviewerExpertiseAvailable();
    const baseSelect = includeExpertise ? 'status, created_at, expertise_keywords_text' : 'status, created_at';

    // Get all reviewers
    const { data: allReviewers } = await supabase
      .from('reviewer_applications')
      .select(baseSelect);

    // Get reviewers with active reviews
    const { data: activeReviewers } = await supabase
      .from('reviewer_applications')
      .select(`
        id,
        reviews:reviews!inner(status)
      `)
      .eq('status', 'APPROVED')
      .in('reviews.status', ['PENDING', 'IN_PROGRESS']);

    // Get new reviewers (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: newReviewers } = await supabase
      .from('reviewer_applications')
      .select('*')
      .gte('created_at', thirtyDaysAgo.toISOString());

    // Count by status
    const statusCounts = {};
    allReviewers?.forEach(reviewer => {
      statusCounts[reviewer.status] = (statusCounts[reviewer.status] || 0) + 1;
    });

    // Count expertise areas
    const expertiseCounts = {};
    if (includeExpertise) {
      allReviewers?.forEach(reviewer => {
        if (reviewer.expertise_keywords_text) {
          const expertiseAreas = reviewer.expertise_keywords_text.split(',').map(area => area.trim()).filter(area => area);
          expertiseAreas.forEach(area => {
            expertiseCounts[area] = (expertiseCounts[area] || 0) + 1;
          });
        }
      });
    }

    const topExpertise = includeExpertise
      ? Object.entries(expertiseCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .map(([name, count]) => ({ name, count }))
      : [];

    return {
      total_reviewers: allReviewers?.length || 0,
  approved_reviewers: statusCounts.APPROVED || statusCounts.approved || 0,
  pending_reviewers: statusCounts.PENDING || statusCounts.pending || 0,
  rejected_reviewers: statusCounts.REJECTED || statusCounts.rejected || 0,
      active_reviewers: activeReviewers?.length || 0,
      new_reviewers_30_days: newReviewers?.length || 0,
      status_breakdown: statusCounts,
      top_expertise_areas: topExpertise
    };
  } catch (err) {
    console.error('Error in getReviewerStatistics:', err);
    throw err;
  }
}

/**
 * Get reviewers by expertise area for assignment recommendations
 * @param {Array} keywords - Keywords to match against expertise
 * @returns {Promise<Array>} - Array of matching reviewers
 */
export async function getReviewersByExpertise(keywords) {
  try {
    if (!keywords || keywords.length === 0) {
      return [];
    }

    const expertiseAvailable = await isReviewerExpertiseAvailable();
    if (!expertiseAvailable) {
      console.warn('Reviewer expertise column unavailable; returning empty recommendations.');
      return [];
    }

    // Search for reviewers whose expertise keywords overlap with keywords
    const { data: reviewers, error } = await supabase
      .from('reviewer_applications')
      .select(`
        id,
        full_name,
        applicant_email,
        institution,
        expertise_keywords_text,
        reviews:reviews(
          id,
          status,
          score
        )
      `)
      .eq('status', 'APPROVED')
      .not('expertise_keywords_text', 'is', null);
    if (error) {
      console.error('Error fetching reviewers by expertise:', error);
      throw error;
    }

    // Calculate match scores
    const matchedReviewers = reviewers?.map(reviewer => {
      const expertiseText = reviewer.expertise_keywords_text || '';
      const expertiseAreas = expertiseText.split(',').map(area => area.trim()).filter(area => area);
      let matchScore = 0;
      const matchedKeywords = [];

      keywords.forEach(keyword => {
        expertiseAreas.forEach(area => {
          if (area.toLowerCase().includes(keyword.toLowerCase()) ||
              keyword.toLowerCase().includes(area.toLowerCase())) {
            matchScore++;
            if (!matchedKeywords.includes(area)) {
              matchedKeywords.push(area);
            }
          }
        });
      });

      // Calculate review performance score
      const completedReviews = reviewer.reviews?.filter(r => r.status === 'COMPLETED') || [];
      const averageScore = completedReviews.length > 0 
        ? completedReviews.reduce((sum, r) => sum + (r.score || 0), 0) / completedReviews.length 
        : 0;

      return {
        ...reviewer,
        match_score: matchScore,
        matched_keywords: matchedKeywords,
        review_count: reviewer.reviews?.length || 0,
        average_review_score: Math.round(averageScore * 10) / 10,
        recommendation_score: matchScore + (averageScore / 10) + (completedReviews.length * 0.1)
      };
    })
    .filter(reviewer => reviewer.match_score > 0)
    .sort((a, b) => b.recommendation_score - a.recommendation_score) || [];

    return matchedReviewers;
  } catch (err) {
    console.error('Error in getReviewersByExpertise:', err);
    throw err;
  }
}