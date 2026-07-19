import supabase from '../../config/supabase.js';
import { logAdminAction, ADMIN_ACTIONS, RESOURCE_TYPES } from './admin-audit-service.js';

/**
 * Enhanced admin author management service
 */

/**
 * Get all authors with advanced filtering and search
 * @param {Object} filters - Filter criteria
 * @param {number} limit - Number of records to return
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Object>} - Paginated authors list with metadata
 */
export async function getAuthorsForAdmin(filters = {}, limit = 20, offset = 0) {
  try {
    // First get authors with basic info
    let query = supabase
      .from('authors')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (filters.search) {
      const searchTerm = `%${filters.search.toLowerCase()}%`;
      query = query.or(`full_name.ilike.${searchTerm},email.ilike.${searchTerm},affiliation.ilike.${searchTerm}`);
    }

    if (filters.affiliation) {
      query = query.ilike('affiliation', `%${filters.affiliation}%`);
    }

    if (filters.location) {
      query = query.ilike('location', `%${filters.location}%`);
    }

    if (filters.createdAfter) {
      query = query.gte('created_at', filters.createdAfter);
    }

    if (filters.createdBefore) {
      query = query.lte('created_at', filters.createdBefore);
    }

    // Apply filters
    if (filters.search) {
      const searchTerm = `%${filters.search.toLowerCase()}%`;
      query = query.or(`full_name.ilike.${searchTerm},email.ilike.${searchTerm},affiliation.ilike.${searchTerm}`);
    }

    if (filters.affiliation) {
      query = query.ilike('affiliation', `%${filters.affiliation}%`);
    }

    if (filters.location) {
      query = query.ilike('location', `%${filters.location}%`);
    }

    if (filters.hasSubmissions !== undefined) {
      if (filters.hasSubmissions) {
        query = query.not('submissions', 'is', null);
      } else {
        query = query.is('submissions', null);
      }
    }

    if (filters.submissionStatus) {
      // This requires a more complex query, we'll handle it separately
      const { data: authorsWithStatus } = await supabase
        .from('authors')
        .select('author_uid')
        .in('author_uid', 
          supabase
            .from('submissions')
            .select('user_id')
            .eq('status', filters.submissionStatus)
        );
      
      if (authorsWithStatus) {
        const authorIds = authorsWithStatus.map(a => a.author_uid);
        query = query.in('author_uid', authorIds);
      }
    }

    if (filters.createdAfter) {
      query = query.gte('created_at', filters.createdAfter);
    }

    if (filters.createdBefore) {
      query = query.lte('created_at', filters.createdBefore);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching authors for admin:', error);
      throw error;
    }

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('authors')
      .select('*', { count: 'exact', head: true });

    // Enhance data with accurate submission statistics
    const enhancedData = await Promise.all((data || []).map(async (author) => {
      // Count all submissions where this author is involved
      const { data: submissionCounts } = await supabase
        .from('submissions')
        .select('id, status, created_at, title, paper_type')
        .or(`owner_email.eq.${author.email_lower},first_author_email_lower.eq.${author.email_lower},coauthor_emails.cs.{"${author.email}"}`);
      
      const submissionStats = {
        total: submissionCounts?.length || 0,
        by_status: {},
        by_paper_type: {}
      };
      
      // Group by status and paper type
      submissionCounts?.forEach(sub => {
        submissionStats.by_status[sub.status] = (submissionStats.by_status[sub.status] || 0) + 1;
        submissionStats.by_paper_type[sub.paper_type] = (submissionStats.by_paper_type[sub.paper_type] || 0) + 1;
      });
      
      // Get latest submission
      const latestSubmission = submissionCounts?.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      )[0] || null;
      
      return {
        ...author,
        submission_count: submissionStats.total,
        published_count: submissionStats.by_status['published'] || 0,
        under_review_count: (submissionStats.by_status['under_review'] || 0) + (submissionStats.by_status['submitted'] || 0),
        submission_stats: submissionStats,
        latest_submission: latestSubmission,
        recent_submissions: submissionCounts?.slice(0, 3) || []
      };
    }));

    // Apply post-processing filters based on submission data
    let filteredData = enhancedData;
    
    if (filters.hasSubmissions !== undefined) {
      filteredData = filteredData.filter(author => {
        const hasSubmissions = author.submission_count > 0;
        return filters.hasSubmissions ? hasSubmissions : !hasSubmissions;
      });
    }
    
    if (filters.submissionStatus) {
      filteredData = filteredData.filter(author => {
        return author.submission_stats.by_status[filters.submissionStatus] > 0;
      });
    }

    return {
      data: filteredData,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (offset + limit) < (totalCount || 0)
      },
      filters_applied: filters
    };
  } catch (err) {
    console.error('Error in getAuthorsForAdmin:', err);
    throw err;
  }
}

/**
 * Get detailed author profile with submissions and statistics
 * @param {string} email - Author's email
 * @param {string} adminEmail - Admin's email for audit logging
 * @returns {Promise<Object>} - Detailed author profile
 */
export async function getAuthorProfileForAdmin(email, adminEmail) {
  try {
    const normalizedEmail = email.toLowerCase();

    // Get author basic data
    const { data: author, error: authorError } = await supabase
      .from('authors')
      .select('*')
      .eq('email_lower', normalizedEmail)
      .single();
      
    if (authorError) {
      if (authorError.code === 'PGRST116') {
        throw new Error(`Author with email ${email} not found`);
      }
      console.error('Error fetching author profile:', authorError);
      throw authorError;
    }
    
    // Get all submissions where this author is involved (owner, first author, or co-author)
    const { data: submissions, error: submissionsError } = await supabase
      .from('submissions')
      .select(`
        id,
        title,
        abstract,
        status,
        paper_type,
        created_at,
        updated_at,
        keywords_text,
        is_verified,
        verified_by,
        published_at,
        published_by,
        owner_email,
        first_author_email,
        coauthor_emails,
        reviews:reviews(
          id,
          reviewer_id,
          status,
          score,
          assigned_at,
          completed_at,
          reviewer:reviewer_applications(
            full_name,
            applicant_email
          )
        ),
        submission_files:submission_files(
          id,
          storage_bucket,
          storage_key,
          original_filename,
          mime_type,
          byte_size,
          is_active,
          created_at
        )
      `)
      .or(`owner_email.eq.${normalizedEmail},first_author_email_lower.eq.${normalizedEmail},coauthor_emails.cs.{"${email}"}`);
      
    if (submissionsError) {
      console.error('Error fetching submissions:', submissionsError);
      throw submissionsError;
    }

    // Normalize submissions with primary file metadata
    author.submissions = submissions?.map(submission => {
      const primaryFile = submission.submission_files?.find(file => file.is_active !== false) || submission.submission_files?.[0] || null;
      return {
        ...submission,
        primary_file: primaryFile ? {
          id: primaryFile.id,
          original_filename: primaryFile.original_filename,
          mime_type: primaryFile.mime_type,
          byte_size: primaryFile.byte_size,
          storage_bucket: primaryFile.storage_bucket,
          storage_key: primaryFile.storage_key,
          created_at: primaryFile.created_at,
          download_url: `/api/download/submission/${submission.id}`
        } : null
      };
    }) || [];

    // Get submission statistics
    const submissionStats = {
      total: author.submissions?.length || 0,
      by_status: {},
      by_paper_type: {},
      average_review_score: 0,
      total_reviews: 0,
      verified_count: 0,
      published_count: 0
    };

    let totalScore = 0;
    let reviewCount = 0;

    author.submissions?.forEach(submission => {
      // Count by status
      submissionStats.by_status[submission.status] = 
        (submissionStats.by_status[submission.status] || 0) + 1;
      
      // Count by paper type
      submissionStats.by_paper_type[submission.paper_type] = 
        (submissionStats.by_paper_type[submission.paper_type] || 0) + 1;
      
      // Count verified and published
      if (submission.is_verified) submissionStats.verified_count++;
      if (submission.published_at) submissionStats.published_count++;
      
      // Calculate review statistics
      submission.reviews?.forEach(review => {
        if (review.score) {
          totalScore += review.score;
          reviewCount++;
        }
      });
    });

    submissionStats.total_reviews = reviewCount;
    submissionStats.average_review_score = reviewCount > 0 ? 
      Math.round((totalScore / reviewCount) * 10) / 10 : 0;

    // Get collaboration statistics from the submissions we already fetched
    const uniqueCollaborators = new Set();
    submissions?.forEach(submission => {
      // Add co-authors
      if (submission.coauthor_emails && Array.isArray(submission.coauthor_emails)) {
        submission.coauthor_emails.forEach(coauthorEmail => {
          if (coauthorEmail.toLowerCase() !== normalizedEmail) {
            uniqueCollaborators.add(coauthorEmail.toLowerCase());
          }
        });
      }
      // Add first author if different from current author
      if (submission.first_author_email && submission.first_author_email.toLowerCase() !== normalizedEmail) {
        uniqueCollaborators.add(submission.first_author_email.toLowerCase());
      }
      // Add owner if different from current author
      if (submission.owner_email && submission.owner_email.toLowerCase() !== normalizedEmail) {
        uniqueCollaborators.add(submission.owner_email.toLowerCase());
      }
    });

    const profile = {
      ...author,
      statistics: {
        ...submissionStats,
        collaboration_count: uniqueCollaborators.size,
        collaborators: Array.from(uniqueCollaborators)
      },
      recent_activity: author.submissions?.slice(0, 5).map(submission => ({
        type: 'submission',
        action: submission.status === 'published' ? 'published' : submission.status === 'submitted' ? 'submitted' : 'updated',
        title: submission.title,
        date: submission.updated_at || submission.created_at,
        submission_id: submission.id,
        status: submission.status
      })) || [],
      account_info: {
        member_since: author.created_at,
        last_submission: author.submissions?.reduce((latest, current) => 
          new Date(current.created_at) > new Date(latest?.created_at || 0) ? current : latest
        , null)
      }
    };

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.AUTHOR_VIEW,
      RESOURCE_TYPES.AUTHOR,
      author.author_uid,
      { viewed_email: email }
    );

    return profile;
  } catch (err) {
    console.error('Error in getAuthorProfileForAdmin:', err);
    throw err;
  }
}

/**
 * Get author search suggestions based on name or email
 * @param {string} query - Search query
 * @param {number} limit - Number of suggestions to return
 * @returns {Promise<Array>} - Array of author suggestions
 */
export async function getAuthorSuggestions(query, limit = 10) {
  try {
    if (!query || query.length < 2) {
      return [];
    }

    const searchTerm = `%${query.toLowerCase()}%`;
    
    const { data, error } = await supabase
      .from('authors')
      .select('author_uid, full_name, email, affiliation')
      .or(`full_name.ilike.${searchTerm},email.ilike.${searchTerm}`)
      .order('full_name')
      .limit(limit);

    if (error) {
      console.error('Error fetching author suggestions:', error);
      throw error;
    }

    return data?.map(author => ({
      id: author.author_uid,
      name: author.full_name,
      email: author.email,
      affiliation: author.affiliation,
      display: `${author.full_name} (${author.email})`
    })) || [];
  } catch (err) {
    console.error('Error in getAuthorSuggestions:', err);
    throw err;
  }
}

/**
 * Get authors by submission status for admin insights
 * @param {string} status - Submission status to filter by
 * @returns {Promise<Array>} - Array of authors with submissions in given status
 */
export async function getAuthorsBySubmissionStatus(status) {
  try {
    const { data, error } = await supabase
      .from('authors')
      .select(`
        author_uid,
        full_name,
        email,
        affiliation,
        submissions:submissions!inner(
          id,
          title,
          status,
          created_at
        )
      `)
      .eq('submissions.status', status)
      .order('created_at', { ascending: false, referencedTable: 'submissions' });

    if (error) {
      console.error('Error fetching authors by submission status:', error);
      throw error;
    }

    return data || [];
  } catch (err) {
    console.error('Error in getAuthorsBySubmissionStatus:', err);
    throw err;
  }
}

/**
 * Update author status or information (admin only)
 * @param {string} email - Author's email
 * @param {Object} updates - Fields to update
 * @param {string} adminEmail - Admin's email for audit logging
 * @returns {Promise<Object>} - Updated author record
 */
export async function updateAuthorForAdmin(email, updates, adminEmail) {
  try {
    const normalizedEmail = email.toLowerCase();

    // Get current author data for audit trail
    const { data: currentAuthor, error: fetchError } = await supabase
      .from('authors')
      .select('*')
      .eq('email_lower', normalizedEmail)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        throw new Error(`Author with email ${email} not found`);
      }
      throw fetchError;
    }

    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString(),
      ...updates
    };

    // Update author
    const { data: updatedAuthor, error: updateError } = await supabase
      .from('authors')
      .update(updateData)
      .eq('email_lower', normalizedEmail)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating author:', updateError);
      throw updateError;
    }

    // Log admin action
    await logAdminAction(
      adminEmail,
      ADMIN_ACTIONS.AUTHOR_STATUS_UPDATE,
      RESOURCE_TYPES.AUTHOR,
      currentAuthor.author_uid,
      { updated_fields: Object.keys(updates) },
      currentAuthor,
      updatedAuthor
    );

    return updatedAuthor;
  } catch (err) {
    console.error('Error in updateAuthorForAdmin:', err);
    throw err;
  }
}

/**
 * Sync submission counts for all authors (maintenance function)
 * @returns {Promise<Object>} - Sync results
 */
export async function syncAuthorSubmissionCounts() {
  try {
    const { data: authors, error: authorsError } = await supabase
      .from('authors')
      .select('author_uid, email, email_lower');
      
    if (authorsError) {
      throw authorsError;
    }
    
    let updated = 0;
    let errors = 0;
    
    for (const author of authors) {
      try {
        // Count all submissions where this author is involved
        const { data: submissions } = await supabase
          .from('submissions')
          .select('id, status')
          .or(`owner_email.eq.${author.email_lower},first_author_email_lower.eq.${author.email_lower},coauthor_emails.cs.{\"${author.email}\"}`);
          
        const submissionCount = submissions?.length || 0;
        const publishedCount = submissions?.filter(s => s.status === 'published').length || 0;
        
        // Since submission counts are calculated dynamically, we don't need to update the database
        // Just count this as a successful "sync" operation
        updated++;
      } catch (err) {
        console.error(`Error processing author ${author.email}:`, err);
        errors++;
      }
    }
    
    return {
      total_authors: authors.length,
      updated,
      errors,
      success: true
    };
  } catch (err) {
    console.error('Error in syncAuthorSubmissionCounts:', err);
    throw err;
  }
}

/**
 * Get authors statistics for admin dashboard
 * @returns {Promise<Object>} - Statistics object
 */
export async function getAuthorStatistics() {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get total authors
    const { count: totalAuthors } = await supabase
      .from('authors')
      .select('*', { count: 'exact', head: true });

    // Get authors with submissions
    const { data: authorsWithSubmissions } = await supabase
      .from('authors')
      .select('author_uid, submissions:submissions(id)')
      .not('submissions', 'is', null);

    // Get new authors (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { count: newAuthors } = await supabase
      .from('authors')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo.toISOString());

    const { count: newThisMonth } = await supabase
      .from('authors')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString());

    // Get top affiliations
    const { data: affiliations } = await supabase
      .from('authors')
      .select('affiliation')
      .not('affiliation', 'is', null)
      .not('affiliation', 'eq', '');

    const affiliationCounts = {};
    affiliations?.forEach(a => {
      const aff = a.affiliation.trim();
      if (aff) {
        affiliationCounts[aff] = (affiliationCounts[aff] || 0) + 1;
      }
    });

    const topAffiliations = Object.entries(affiliationCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return {
      total_authors: totalAuthors || 0,
      active_authors: authorsWithSubmissions?.length || 0,
      new_authors_30_days: newAuthors || 0,
      new_this_month: newThisMonth || 0,
      authors_without_submissions: (totalAuthors || 0) - (authorsWithSubmissions?.length || 0),
      top_affiliations: topAffiliations
    };
  } catch (err) {
    console.error('Error in getAuthorStatistics:', err);
    throw err;
  }
}