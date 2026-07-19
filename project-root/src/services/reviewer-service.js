import supabase from '../../config/supabase.js';
import { uploadFile } from './supabase-storage.js';
import { getAccountByEmail, createAccount } from './account-service.js';

/**
 * Create a new reviewer application in the database
 * @param {Object} applicationData - The reviewer application data (includes expertise as comma-separated string)
 * @param {Object} user - The authenticated user
 * @param {Buffer} cvBuffer - The CV file buffer to upload (null if using cvUrl)
 * @param {String} cvFileName - The original CV file name (null if using cvUrl)
 * @param {String} cvContentType - The CV file content type (null if using cvUrl)
 * @param {String} cvUrl - The CV URL (optional, used when cvBuffer is null)
 * @returns {Promise<Object>} - The created reviewer application
 */
export async function createReviewerApplication(applicationData, user, cvBuffer, cvFileName, cvContentType, cvUrl) {
  try {
    // Ensure user has an account - email is the main identifier
    let account = await getAccountByEmail(user.email);
    if (!account) {
      account = await createAccount(user.email, user.auth0Id);
    }
    
    let uploadResult = null;
    
    // Handle either file upload or URL
    if (cvBuffer) {
      // Upload the CV to Supabase Storage
      uploadResult = await uploadFile(cvBuffer, cvFileName, cvContentType, 'cv');
    }
    
    // Create the reviewer application
    const { data: application, error } = await supabase
      .from('reviewer_applications')
      .insert({
        user_id: account.id, // Use account.id instead of auth0Id
        applicant_email: user.email,
        full_name: applicationData.fullName || user.name,
        degree: applicationData.degree,
        experience: applicationData.experience,
        institution: applicationData.institution,
        expertise_keywords_text: applicationData.expertise || null,
        cv_bucket: uploadResult ? uploadResult.bucket : null,
        cv_key: uploadResult ? uploadResult.key : null,
        cv_url: cvUrl || null,
        status: 'PENDING'
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating reviewer application:', error);
      throw new Error('Failed to create reviewer application');
    }
    
    return application;
  } catch (error) {
    console.error('Error creating reviewer application:', error);
    throw new Error('Failed to create reviewer application');
  }
}

/**
 * Get all reviewer applications
 * @param {Object} filters - Optional filters
 * @returns {Promise<Array>} - List of reviewer applications
 */
export async function getReviewerApplications(filters = {}) {
  try {
    let query = supabase
      .from('reviewer_applications')
      .select('*');
    
    // Apply filters
    if (filters.userId) {
      query = query.eq('user_id', filters.userId);
    }
    
    if (filters.email) {
      query = query.eq('applicant_email_lower', filters.email.toLowerCase());
    }
    
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    
    // Order by creation date
    query = query.order('created_at', { ascending: false });
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error getting reviewer applications:', error);
      throw new Error('Failed to get reviewer applications');
    }
    
    return data || [];
  } catch (error) {
    console.error('Error getting reviewer applications:', error);
    throw new Error('Failed to get reviewer applications');
  }
}

/**
 * Get a reviewer application by ID
 * @param {String} id - The reviewer application ID
 * @returns {Promise<Object>} - The reviewer application
 */
export async function getReviewerApplicationById(id) {
  try {
    const { data, error } = await supabase
      .from('reviewer_applications')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error('Error getting reviewer application by ID:', error);
      throw new Error('Failed to get reviewer application');
    }
    
    return data;
  } catch (error) {
    console.error('Error getting reviewer application by ID:', error);
    throw new Error('Failed to get reviewer application');
  }
}

/**
 * Get a reviewer application by user ID
 * @param {String} userId - The user ID
 * @returns {Promise<Object|null>} - The reviewer application or null if not found
 */
export async function getReviewerApplicationByUserId(userId) {
  try {
    if (!userId) {
      console.warn('Invalid user ID provided:', userId);
      return null;
    }
    
    const { data, error } = await supabase
      .from('reviewer_applications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
      console.error('Error getting reviewer application by user ID:', error);
      throw new Error('Failed to get reviewer application');
    }
    
    return data;
  } catch (error) {
    console.error('Error getting reviewer application by user ID:', error);
    throw new Error('Failed to get reviewer application');
  }
}

/**
 * Update a reviewer application status
 * @param {String} id - The reviewer application ID
 * @param {String} status - The new status
 * @returns {Promise<Object>} - The updated reviewer application
 */
export async function updateReviewerApplicationStatus(id, status) {
  try {
    const { data, error } = await supabase
      .from('reviewer_applications')
      .update({
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating reviewer application status:', error);
      throw new Error('Failed to update reviewer application status');
    }
    
    return data;
  } catch (error) {
    console.error('Error updating reviewer application status:', error);
    throw new Error('Failed to update reviewer application status');
  }
}

/**
 * Get a reviewer application by email
 * @param {String} email - The email address
 * @returns {Promise<Object|null>} - The reviewer application or null if not found
 */
export async function getReviewerApplicationByEmail(email) {
  try {
    if (!email) {
      console.warn('Invalid email provided:', email);
      return null;
    }
    
    const { data, error } = await supabase
      .from('reviewer_applications')
      .select('*')
      .eq('applicant_email_lower', email.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
      console.error('Error getting reviewer application by email:', error);
      throw new Error('Failed to get reviewer application');
    }
    
    return data;
  } catch (error) {
    console.error('Error getting reviewer application by email:', error);
    throw new Error('Failed to get reviewer application');
  }
}

/**
 * Get a reviewer profile by user ID
 * @param {String} userId - The user ID
 * @returns {Promise<Object|null>} - The reviewer profile or null if not found
 */
export async function getReviewerProfileByUserId(userId) {
  try {
    // For now, this is an alias to getReviewerApplicationByUserId
    // In the future, this might be a separate table or have additional logic
    return await getReviewerApplicationByUserId(userId);
  } catch (error) {
    console.error('Error getting reviewer profile by user ID:', error);
    throw new Error('Failed to get reviewer profile');
  }
}