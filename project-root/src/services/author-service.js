import supabase from '../../config/supabase.js';

/**
 * Get an author by email
 * @param {string} email - The email address
 * @returns {Promise<Object|null>} - The author or null if not found
 */
export async function getAuthorByEmail(email) {
  try {
    const { data, error } = await supabase
      .from('authors')
      .select('*')
      .eq('email_lower', email.toLowerCase())
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
      console.error('Error getting author by email:', error);
      throw new Error('Failed to get author');
    }
    
    return data;
  } catch (error) {
    console.error('Error getting author by email:', error);
    throw new Error('Failed to get author');
  }
}

/**
 * Create a new author
 * @param {Object} authorData - The author data
 * @param {string} authorData.email - The email address
 * @param {string} authorData.fullName - The full name
 * @param {string} authorData.affiliation - The affiliation (optional)
 * @param {string} authorData.location - The location (optional)
 * @returns {Promise<Object>} - The created author
 */
export async function createAuthor(authorData) {
  try {
    // Validate required fields
    if (!authorData.email) {
      throw new Error('Author email is required');
    }
    
    if (!authorData.fullName || authorData.fullName.trim() === '') {
      console.warn(`Creating author with missing name for email: ${authorData.email}`);
    }
    
    // Check if author already exists
    const existingAuthor = await getAuthorByEmail(authorData.email);
    if (existingAuthor) {
      return existingAuthor;
    }
    
    // Create new author with validation
    const { data, error } = await supabase
      .from('authors')
      .insert({
        email: authorData.email,
        full_name: authorData.fullName?.trim() || null,
        affiliation: authorData.affiliation?.trim() || null,
        location: authorData.location?.trim() || null
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating author:', error);
      throw new Error('Failed to create author');
    }
    
    return data;
  } catch (error) {
    console.error('Error creating author:', error);
    throw new Error('Failed to create author');
  }
}

/**
 * Update an author
 * @param {string} email - The email address
 * @param {Object} authorData - The author data to update
 * @param {string} authorData.fullName - The full name (optional)
 * @param {string} authorData.affiliation - The affiliation (optional)
 * @param {string} authorData.location - The location (optional)
 * @returns {Promise<Object>} - The updated author
 */
export async function updateAuthor(email, authorData) {
  try {
    const updateData = {};
    
    // Only update fields that are explicitly provided (not undefined)
    if (authorData.fullName !== undefined) updateData.full_name = authorData.fullName;
    if (authorData.affiliation !== undefined) updateData.affiliation = authorData.affiliation;
    if (authorData.location !== undefined) updateData.location = authorData.location;
    
    // Only proceed if there's something to update
    if (Object.keys(updateData).length === 0) {
      // Return existing author if no updates needed
      return await getAuthorByEmail(email);
    }
    
    const { data, error } = await supabase
      .from('authors')
      .update(updateData)
      .eq('email_lower', email.toLowerCase())
      .select()
      .single();
    
    if (error) {
      console.error('Error updating author:', error);
      throw new Error('Failed to update author');
    }
    
    return data;
  } catch (error) {
    console.error('Error updating author:', error);
    throw new Error('Failed to update author');
  }
}

/**
 * Get all authors
 * @returns {Promise<Array>} - List of authors
 */
export async function getAllAuthors() {
  try {
    const { data, error } = await supabase
      .from('authors')
      .select('*')
      .order('full_name', { ascending: true });
    
    if (error) {
      console.error('Error getting all authors:', error);
      throw new Error('Failed to get authors');
    }
    
    return data || [];
  } catch (error) {
    console.error('Error getting all authors:', error);
    throw new Error('Failed to get authors');
  }
}