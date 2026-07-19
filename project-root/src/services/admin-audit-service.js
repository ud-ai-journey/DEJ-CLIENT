import supabase from '../../config/supabase.js';

/**
 * Admin audit logging service for tracking all admin actions
 */

/**
 * Log an admin action for audit purposes
 * @param {string} adminEmail - Email of the admin performing the action
 * @param {string} action - The action being performed
 * @param {string} resourceType - Type of resource (submission, reviewer, author, review, etc.)
 * @param {string|number} resourceId - ID of the affected resource
 * @param {Object} details - Additional details about the action
 * @param {Object} oldData - Previous state of the resource (optional)
 * @param {Object} newData - New state of the resource (optional)
 * @returns {Promise<Object>} - The created audit log entry
 */
export async function logAdminAction(
  adminEmail,
  action,
  resourceType,
  resourceId, // must be a UUID string
  details = {},
  oldData = null,
  newData = null
) {
  try {
    const auditEntry = {
      admin_id: adminEmail.toLowerCase(),
      action,
      target_id: resourceId, // keep as UUID if your domain uses it
      metadata: {
        resource_type: resourceType,
        details,
        old_data: oldData,
        new_data: newData,
        ip_address: details.ip_address || null,
        user_agent: details.user_agent || null
      }
      // created_at is DB-managed
    };

    const { data, error } = await supabase
      .from('admin_actions')
      .insert(auditEntry)
      .select()
      .single();

    if (error) {
      console.error('Failed to log admin action:', error);
      return null; // don't break main flow
    }

    return data;
  } catch (err) {
    console.error('Error in logAdminAction:', err);
    return null;
  }
}
// admin-audit-service.js

export const ADMIN_ACTIONS = {
  // Submission actions
  SUBMISSION_VERIFY: 'submission_verify',
  SUBMISSION_ASSIGN_REVIEWER: 'submission_assign_reviewer',
  SUBMISSION_PUBLISH: 'submission_publish',
  SUBMISSION_REQUEST_REVISION: 'submission_request_revision',
  SUBMISSION_STATUS_UPDATE: 'submission_status_update',
  SUBMISSION_VIEW: 'submission_view',
  SUBMISSION_MARK_REVIEW_COMPLETED: 'submission_mark_review_completed',

  // Reviewer actions
  REVIEWER_VERIFY: 'reviewer_verify',
  REVIEWER_APPROVE: 'reviewer_approve',
  REVIEWER_REJECT: 'reviewer_reject',
  REVIEWER_STATUS_UPDATE: 'reviewer_status_update',
  REVIEWER_VIEW: 'reviewer_view',

  // Review actions
  REVIEW_VIEW: 'review_view',
  REVIEW_COMPLETE: 'review_complete',
  REVIEW_ASSIGN: 'review_assign',
  REVIEW_UNASSIGN: 'review_unassign',
  REVIEW_REMINDER_SENT: 'review_reminder_sent',
  REVIEW_REASSIGN: 'review_reassign',

  // Author actions
  AUTHOR_VIEW: 'author_view',
  AUTHOR_STATUS_UPDATE: 'author_status_update',

  // User actions
  USER_ROLE_UPDATE: 'user_role_update',
  USER_STATUS_UPDATE: 'user_status_update',
  USER_VIEW: 'user_view',

  // System actions
  SYSTEM_LOGIN: 'system_login',
  SYSTEM_LOGOUT: 'system_logout'
};

export const RESOURCE_TYPES = {
  SUBMISSION: 'submission',
  REVIEWER: 'reviewer',
  REVIEW: 'review',
  AUTHOR: 'author',
  USER: 'user',
  SYSTEM: 'system'
};
/**
 * Get admin action history
 * @param {Object} filters - Filters for the audit log
 * @param {number} limit - Number of records to return
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Array>} - Array of audit log entries
 */
export async function getAdminActionHistory(filters = {}, limit = 50, offset = 0) {
  try {
    let query = supabase
      .from('admin_actions')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.adminEmail) {
      query = query.eq('admin_id', filters.adminEmail.toLowerCase());
    }
    if (filters.action) {
      query = query.eq('action', filters.action);
    }
    if (filters.targetId) {
      query = query.eq('target_id', filters.targetId);
    }
    if (filters.resourceType) {
      query = query.eq('metadata->>resource_type', filters.resourceType);
    }
    if (filters.ipAddress) {
      query = query.eq('metadata->>ip_address', filters.ipAddress);
    }
    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte('created_at', filters.dateTo);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching admin action history:', error);
      throw error;
    }

    return data || [];
  } catch (err) {
    console.error('Error in getAdminActionHistory:', err);
    throw err;
  }
}
/**
 * Get audit statistics for admin dashboard
 * @param {number} days - Number of days to look back
 * @returns {Promise<Object>} - Statistics object
 */
export async function getAdminAuditStats(days = 30) {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabase
      .from('admin_actions')
      .select('action, metadata, created_at')
      .gte('created_at', since.toISOString());

    if (error) {
      console.error('Error fetching admin audit stats:', error);
      throw error;
    }

    const stats = {
      total_actions: data.length,
      actions_by_type: {},
      resources_by_type: {},
      actions_by_day: {},
      recent_activity: data.slice(0, 10)
    };

    data.forEach(entry => {
      const resourceType = entry.metadata?.resource_type || 'unknown';
      stats.actions_by_type[entry.action] = (stats.actions_by_type[entry.action] || 0) + 1;
      stats.resources_by_type[resourceType] = (stats.resources_by_type[resourceType] || 0) + 1;

      const day = entry.created_at.split('T')[0];
      stats.actions_by_day[day] = (stats.actions_by_day[day] || 0) + 1;
    });

    return stats;
  } catch (err) {
    console.error('Error in getAdminAuditStats:', err);
    throw err;
  }
}
/**
 * Resource types constants
 */


/**
 * Helper function to create a standardized audit context
 * @param {Object} req - Express request object
 * @returns {Object} - Context object for audit logging
 */
export function createAuditContext(req) {
  return {
    ip_address: req.ip || req.connection?.remoteAddress || null,
    user_agent: req.get('User-Agent') || null
  };
}