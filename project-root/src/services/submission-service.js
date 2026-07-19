import supabase from '../../config/supabase.js';
import { uploadFile } from './supabase-storage.js';
import { getAccountByEmail, createAccount } from './account-service.js';
import { getAuthorByEmail, createAuthor, updateAuthor } from './author-service.js';

/**
 * Create a new submission in the database
 * @param {Object} submissionData - The submission data
 * @param {Object} user - The authenticated user
 * @param {Buffer} fileBuffer - The file buffer to upload (optional if file_url is provided)
 * @param {String} fileName - The original file name (optional if file_url is provided)
 * @param {String} contentType - The file content type (optional if file_url is provided)
 * @param {String} file_url - The URL of the already uploaded file (optional if fileBuffer is provided)
 * @returns {Promise<Object>} - The created submission
 */
export async function createSubmission(submissionData, user, fileBuffer, fileName, contentType, file_url) {
  try {
    // Ensure user has an account - email is the main identifier
    let account = await getAccountByEmail(user.email);
    if (!account) {
      // Create account with email as primary identifier, auth0Id as optional
      account = await createAccount(user.email, user.auth0Id);
    }
    
    // Ensure first author exists - using email as main identifier
    const firstAuthorEmail = submissionData.firstAuthorEmail || user.email;
    let firstAuthor = await getAuthorByEmail(firstAuthorEmail);
    if (!firstAuthor) {
      firstAuthor = await createAuthor({
        email: firstAuthorEmail,
        fullName: submissionData.firstAuthorName || user.name
      });
    }
    
    // Handle file upload or use provided file URL
    let uploadResult;
    if (fileBuffer) {
      // Upload the file to Supabase Storage if buffer is provided
      uploadResult = await uploadFile(fileBuffer, fileName, contentType, 'paper');
    } else if (file_url) {
      // Use the provided file URL
      uploadResult = {
        bucket: 'paper',
        key: file_url,
        url: file_url
      };
    } else {
      throw new Error('Either file buffer or file URL must be provided');
    }
    
    // Extract coauthor emails from authors array (excluding first author)
    const coauthorEmails = submissionData.authors && submissionData.authors.length > 1
      ? submissionData.authors.slice(1).map(author => author.email)
      : [];

    // Create the submission in the database
    // Use email as the main identifier, with auth0Id as secondary reference
    const { data: submission, error } = await supabase
      .from('submissions')
      .insert({
        user_id: account.auth_user_id, // Use auth_user_id from account_emails
        owner_email: user.email,
        first_author_email: firstAuthorEmail,
        title: submissionData.title,
        paper_type: submissionData.paper_type || 'Research Paper',
        abstract: submissionData.abstract,
        keywords_text: submissionData.keywords,
        terms_accepted: submissionData.termsAccepted || false,
        status: 'submitted',
        // Add support for new fields
        coauthor_emails: coauthorEmails,
        metadata: submissionData.metadata || {}
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating submission:', error);
      throw new Error('Failed to create submission');
    }
    
    // Add submission file
    const { error: fileError } = await supabase
      .from('submission_files')
      .insert({
        submission_id: submission.id,
        storage_bucket: uploadResult.bucket,
        storage_key: uploadResult.key,
        original_filename: fileName || 'uploaded-file',
        mime_type: contentType || 'application/octet-stream',
        byte_size: fileBuffer ? fileBuffer.length : 0,
        is_active: true
      });
    
    if (fileError) {
      console.error('Error adding submission file:', fileError);
      throw new Error('Failed to add submission file');
    }
    
    // Add submission authors
    if (submissionData.authors && submissionData.authors.length > 0) {
      console.log('Processing authors for submission:', submission.id);
      console.log('Authors data received:', JSON.stringify(submissionData.authors, null, 2));
      
      const authorEntries = await Promise.all(submissionData.authors.map(async (authorData, index) => {
        console.log(`Processing author ${index + 1}:`, JSON.stringify(authorData, null, 2));
        
        // Validate author data
        if (!authorData.email || !authorData.email.trim()) {
          console.error(`Author at position ${index + 1} is missing email address`);
          throw new Error(`Author at position ${index + 1} is missing email address`);
        }
        
        if (!authorData.fullName || !authorData.fullName.trim()) {
          console.warn(`Author at position ${index + 1} (${authorData.email}) is missing full name`);
        }
        
        // Ensure author exists
        let author = await getAuthorByEmail(authorData.email);
        if (!author) {
          console.log(`Creating new author record for ${authorData.email}`);
          author = await createAuthor({
            email: authorData.email,
            fullName: authorData.fullName,
            affiliation: authorData.affiliation,
            location: authorData.location
          });
          console.log(`Created author:`, JSON.stringify(author, null, 2));
        } else {
          // Update existing author with new data if any fields are provided
          const hasUpdates = authorData.fullName !== undefined || 
                           authorData.affiliation !== undefined || 
                           authorData.location !== undefined;
          if (hasUpdates) {
            console.log(`Updating existing author ${authorData.email} with new data`);
            author = await updateAuthor(authorData.email, {
              fullName: authorData.fullName,
              affiliation: authorData.affiliation,
              location: authorData.location
            });
            console.log(`Updated author:`, JSON.stringify(author, null, 2));
          }
        }
        
        const authorEntry = {
          submission_id: submission.id,
          author_email: authorData.email,
          author_order: index + 1,
          receive_communications: authorData.receiveCommunications || false
        };
        
        console.log(`Creating submission_author entry:`, JSON.stringify(authorEntry, null, 2));
        return authorEntry;
      }));
      
      console.log(`Inserting ${authorEntries.length} author entries into submission_authors table`);
      const { error: authorsError } = await supabase
        .from('submission_authors')
        .insert(authorEntries);
      
      if (authorsError) {
        console.error('Error adding submission authors:', authorsError);
        throw new Error('Failed to add submission authors');
      }
      
      console.log('✅ Successfully added submission authors');
    } else {
      console.warn('No authors data provided or authors array is empty');
      console.log('submissionData.authors:', submissionData.authors);
    }
    
    // Add keywords if provided
    if (submissionData.keywords) {
      const keywordsList = submissionData.keywords.split(',').map(k => k.trim());
      
      for (const keyword of keywordsList) {
        // Check if keyword exists
        const { data: existingKeyword } = await supabase
          .from('keywords')
          .select('id')
          .eq('name', keyword)
          .single();
        
        let keywordId;
        
        if (existingKeyword) {
          keywordId = existingKeyword.id;
        } else {
          // Create new keyword
          const { data: newKeyword, error: keywordError } = await supabase
            .from('keywords')
            .insert({ name: keyword })
            .select()
            .single();
          
          if (keywordError) {
            console.error('Error creating keyword:', keywordError);
            continue;
          }
          
          keywordId = newKeyword.id;
        }
        
        // Link keyword to submission
        await supabase
          .from('submission_keywords')
          .insert({
            submission_id: submission.id,
            keyword_id: keywordId
          });
      }
    }
    
    return submission;
  } catch (error) {
    console.error('Error creating submission:', error);
    throw new Error('Failed to create submission');
  }
}

/**
 * Get all submissions
 * @param {Object} filters - Optional filters
 * @returns {Promise<Array>} - List of submissions
 */
export async function getSubmissions(filters = {}) {
  try {
    let query = supabase
      .from('submissions')
      .select(`
        *,
        submission_files(*),
        submission_authors(*),
        submission_keywords(*, keywords(*))
      `);
    
    // Apply filters
    if (filters.userId) {
      query = query.eq('user_id', filters.userId);
    }
    
    if (filters.email) {
      query = query.eq('owner_email_lower', filters.email.toLowerCase());
    }
    
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    
    // Order by creation date
    query = query.order('created_at', { ascending: false });
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error getting submissions:', error);
      throw new Error('Failed to get submissions');
    }
    
    return data || [];
  } catch (error) {
    console.error('Error getting submissions:', error);
    throw new Error('Failed to get submissions');
  }
}

/**
 * Get a submission by ID
 * @param {String} id - The submission ID
 * @returns {Promise<Object>} - The submission
 */
export async function getSubmissionById(id) {
  try {
    const { data, error } = await supabase
      .from('submissions')
      .select(`
        *,
        submission_files(*),
        submission_authors(*),
        submission_keywords(*, keywords(*))
      `)
      .eq('id', id)
      .single();
    
    if (error) {
      console.error('Error getting submission by ID:', error);
      throw new Error('Failed to get submission');
    }
    
    return data;
  } catch (error) {
    console.error('Error getting submission by ID:', error);
    throw new Error('Failed to get submission');
  }
}

/**
 * Update a submission
 * @param {String} id - The submission ID
 * @param {Object} updateData - The data to update
 * @returns {Promise<Object>} - The updated submission
 */
export async function updateSubmission(id, updateData) {
  try {
    const updates = {};
    
    // Only update allowed fields
    if (updateData.title !== undefined) updates.title = updateData.title;
    if (updateData.abstract !== undefined) updates.abstract = updateData.abstract;
    if (updateData.keywords !== undefined) updates.keywords_text = updateData.keywords;
    if (updateData.paperType !== undefined) updates.paper_type = updateData.paperType;
    if (updateData.status !== undefined) updates.status = updateData.status;
    if (updateData.termsAccepted !== undefined) updates.terms_accepted = updateData.termsAccepted;
    
    // Add updated_at timestamp
    updates.updated_at = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('submissions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating submission:', error);
      throw new Error('Failed to update submission');
    }
    
    // Update keywords if provided
    if (updateData.keywords !== undefined) {
      // First, remove all existing keyword associations
      await supabase
        .from('submission_keywords')
        .delete()
        .eq('submission_id', id);
      
      // Then add new keywords
      const keywordsList = updateData.keywords.split(',').map(k => k.trim());
      
      for (const keyword of keywordsList) {
        // Check if keyword exists
        const { data: existingKeyword } = await supabase
          .from('keywords')
          .select('id')
          .eq('name', keyword)
          .single();
        
        let keywordId;
        
        if (existingKeyword) {
          keywordId = existingKeyword.id;
        } else {
          // Create new keyword
          const { data: newKeyword, error: keywordError } = await supabase
            .from('keywords')
            .insert({ name: keyword })
            .select()
            .single();
          
          if (keywordError) {
            console.error('Error creating keyword:', keywordError);
            continue;
          }
          
          keywordId = newKeyword.id;
        }
        
        // Link keyword to submission
        await supabase
          .from('submission_keywords')
          .insert({
            submission_id: id,
            keyword_id: keywordId
          });
      }
    }
    
    return data;
  } catch (error) {
    console.error('Error updating submission:', error);
    throw new Error('Failed to update submission');
  }
}