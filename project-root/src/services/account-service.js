import supabase from '../../config/supabase.js';

// Store Auth0 IDs directly without conversion
function formatAuthIdForDb(authId) {
  return authId; // Store Auth0 ID directly without conversion
}

/**
 * Get an account by email
 * @param {string} email - The email address
 * @returns {Promise<Object|null>} - The account or null if not found
 */
export async function getAccountByEmail(email) {
  try {
    const { data, error } = await supabase
      .from('account_emails')
      .select('*')
      .eq('email_lower', email.toLowerCase())
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
      console.error('Error getting account by email:', error);
      throw new Error('Failed to get account');
    }
    
    return data;
  } catch (error) {
    console.error('Error getting account by email:', error);
    throw new Error('Failed to get account');
  }
}

/**
 * Create a new account
 * @param {string} email - The email address
 * @param {string} authUserId - The Auth0 user ID (optional)
 * @returns {Promise<Object>} - The created account
 */
export async function createAccount(email, authUserId = null) {
  try {
    // Check if account already exists
    const existingAccount = await getAccountByEmail(email);
    if (existingAccount) {
      return existingAccount;
    }
    
    // Create new account
    // Store Auth0 ID directly without conversion
    const { data, error } = await supabase
      .from('account_emails')
      .insert({
        email: email,
        auth_user_id: authUserId
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating account:', error);
      throw new Error('Failed to create account');
    }
    
    return data;
  } catch (error) {
    console.error('Error creating account:', error);
    throw new Error('Failed to create account');
  }
}

/**
 * Update an account's Auth0 user ID
 * @param {string} email - The email address
 * @param {string} authUserId - The Auth0 user ID
 * @returns {Promise<Object>} - The updated account
 */
export async function updateAccountAuthId(email, authUserId) {
  try {
    // Store Auth0 ID directly without conversion
    const { data, error } = await supabase
      .from('account_emails')
      .update({ auth_user_id: authUserId })
      .eq('email_lower', email.toLowerCase())
      .select()
      .single();
    
    if (error) {
      console.error('Error updating account auth ID:', error);
      throw new Error('Failed to update account');
    }
    
    return data;
  } catch (error) {
    console.error('Error updating account auth ID:', error);
    throw new Error('Failed to update account');
  }
}

/**
 * Get an account by Auth0 user ID
 * @param {string} authUserId - The Auth0 user ID
 * @returns {Promise<Object|null>} - The account or null if not found
 */
export async function getAccountByAuthId(authUserId) {
  try {
    // Use Auth0 ID directly without conversion
    const { data, error } = await supabase
      .from('account_emails')
      .select('*')
      .eq('auth_user_id', authUserId)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
      console.error('Error getting account by auth ID:', error);
      throw new Error('Failed to get account');
    }
    
    return data;
  } catch (error) {
    console.error('Error getting account by auth ID:', error);
    throw new Error('Failed to get account');
  }
}

/**
 * Get all users with optional filtering
 * @param {Object} args - The filter arguments (similar to Prisma's findMany)
 * @returns {Promise<Array>} - Array of user accounts
 */
export async function getUsers(args = {}) {
  try {
    let query = supabase.from('account_emails').select('*');
    
  
    if (args.where) {
      // Handle common filter patterns
      if (args.where.email) {
        query = query.eq('email_lower', args.where.email.toLowerCase());
      }
      if (args.where.auth0Id) {
        query = query.eq('auth_user_id', args.where.auth0Id);
      }
      // Add more filters as needed
    }
    
    // Apply pagination if provided
    if (args.skip) {
      query = query.range(args.skip, args.skip + (args.take || 10) - 1);
    } else if (args.take) {
      query = query.limit(args.take);
    }
    
    // Execute query
    const { data, error } = await query;
    
    if (error) {
      console.error('Error getting users:', error);
      throw new Error('Failed to get users');
    }
    
    return data || [];
  } catch (error) {
    console.error('Error getting users:', error);
    return [];
  }
}