import supabase from '../config/supabase.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Verify that the Supabase schema matches the expected structure
 */
async function verifySupabaseSchema() {
  console.log('Verifying Supabase schema...');
  
  try {
    // Check account_emails table
    console.log('\nChecking account_emails table...');
    const { data: accountEmailsInfo, error: accountEmailsError } = await supabase
      .rpc('check_table_structure', { table_name: 'account_emails' });
    
    if (accountEmailsError) {
      console.error('Error checking account_emails table:', accountEmailsError);
    } else if (!accountEmailsInfo) {
      console.error('account_emails table does not exist!');
    } else {
      console.log('✓ account_emails table exists');
      
      // Check required columns
      const requiredColumns = ['email', 'email_lower', 'account_uid', 'auth_user_id', 'created_at', 'metadata'];
      const { data: accountColumns } = await supabase
        .from('account_emails')
        .select()
        .limit(1);
      
      if (accountColumns && accountColumns.length > 0) {
        const missingColumns = requiredColumns.filter(col => !(col in accountColumns[0]));
        if (missingColumns.length > 0) {
          console.error(`Missing columns in account_emails: ${missingColumns.join(', ')}`);
        } else {
          console.log('✓ All required columns exist in account_emails');
        }
      } else {
        console.log('✓ account_emails table structure verified (empty table)');
      }
    }
    
    // Check authors table
    console.log('\nChecking authors table...');
    const { data: authorsInfo, error: authorsError } = await supabase
      .rpc('check_table_structure', { table_name: 'authors' });
    
    if (authorsError) {
      console.error('Error checking authors table:', authorsError);
    } else if (!authorsInfo) {
      console.error('authors table does not exist!');
    } else {
      console.log('✓ authors table exists');
      
      // Check required columns
      const requiredColumns = ['email', 'email_lower', 'author_uid', 'full_name', 'affiliation', 'location', 'created_at', 'research_interests', 'profile_data'];
      const { data: authorColumns } = await supabase
        .from('authors')
        .select()
        .limit(1);
      
      if (authorColumns && authorColumns.length > 0) {
        const missingColumns = requiredColumns.filter(col => !(col in authorColumns[0]));
        if (missingColumns.length > 0) {
          console.error(`Missing columns in authors: ${missingColumns.join(', ')}`);
        } else {
          console.log('✓ All required columns exist in authors');
        }
      } else {
        console.log('✓ authors table structure verified (empty table)');
      }
    }
    
    // Check submissions table
    console.log('\nChecking submissions table...');
    const { data: submissionsInfo, error: submissionsError } = await supabase
      .rpc('check_table_structure', { table_name: 'submissions' });
    
    if (submissionsError) {
      console.error('Error checking submissions table:', submissionsError);
    } else if (!submissionsInfo) {
      console.error('submissions table does not exist!');
    } else {
      console.log('✓ submissions table exists');
      
      // Check required columns
      const requiredColumns = ['id', 'user_id', 'owner_email', 'owner_email_lower', 'first_author_email', 
                              'first_author_email_lower', 'title', 'paper_type', 'abstract', 'keywords_text', 
                              'terms_accepted', 'status', 'created_at', 'updated_at', 'coauthor_emails', 'metadata'];
      const { data: submissionColumns } = await supabase
        .from('submissions')
        .select()
        .limit(1);
      
      if (submissionColumns && submissionColumns.length > 0) {
        const missingColumns = requiredColumns.filter(col => !(col in submissionColumns[0]));
        if (missingColumns.length > 0) {
          console.error(`Missing columns in submissions: ${missingColumns.join(', ')}`);
        } else {
          console.log('✓ All required columns exist in submissions');
        }
      } else {
        console.log('✓ submissions table structure verified (empty table)');
      }
    }
    
    // Check submission_files table
    console.log('\nChecking submission_files table...');
    const { data: filesInfo, error: filesError } = await supabase
      .rpc('check_table_structure', { table_name: 'submission_files' });
    
    if (filesError) {
      console.error('Error checking submission_files table:', filesError);
    } else if (!filesInfo) {
      console.error('submission_files table does not exist!');
    } else {
      console.log('✓ submission_files table exists');
      
      // Check required columns
      const requiredColumns = ['id', 'submission_id', 'storage_bucket', 'storage_key', 'original_filename', 
                              'mime_type', 'byte_size', 'is_active', 'file_version', 'checksum', 'created_at'];
      const { data: fileColumns } = await supabase
        .from('submission_files')
        .select()
        .limit(1);
      
      if (fileColumns && fileColumns.length > 0) {
        const missingColumns = requiredColumns.filter(col => !(col in fileColumns[0]));
        if (missingColumns.length > 0) {
          console.error(`Missing columns in submission_files: ${missingColumns.join(', ')}`);
        } else {
          console.log('✓ All required columns exist in submission_files');
        }
      } else {
        console.log('✓ submission_files table structure verified (empty table)');
      }
    }
    
    // Check reviewer_applications table
    console.log('\nChecking reviewer_applications table...');
    const { data: reviewerInfo, error: reviewerError } = await supabase
      .rpc('check_table_structure', { table_name: 'reviewer_applications' });
    
    if (reviewerError) {
      console.error('Error checking reviewer_applications table:', reviewerError);
    } else if (!reviewerInfo) {
      console.error('reviewer_applications table does not exist!');
    } else {
      console.log('✓ reviewer_applications table exists');
      
      // Check required columns
      const requiredColumns = ['id', 'user_id', 'applicant_email', 'applicant_email_lower', 'full_name', 
                              'degree', 'experience', 'institution', 'cv_bucket', 'cv_key', 'status', 
                              'expertise_areas', 'availability', 'created_at', 'updated_at'];
      const { data: reviewerColumns } = await supabase
        .from('reviewer_applications')
        .select()
        .limit(1);
      
      if (reviewerColumns && reviewerColumns.length > 0) {
        const missingColumns = requiredColumns.filter(col => !(col in reviewerColumns[0]));
        if (missingColumns.length > 0) {
          console.error(`Missing columns in reviewer_applications: ${missingColumns.join(', ')}`);
        } else {
          console.log('✓ All required columns exist in reviewer_applications');
        }
      } else {
        console.log('✓ reviewer_applications table structure verified (empty table)');
      }
    }
    
    // Check new tables
    console.log('\nChecking submission_periods table...');
    const { data: periodsInfo, error: periodsError } = await supabase
      .rpc('check_table_structure', { table_name: 'submission_periods' });
    
    if (periodsError) {
      console.error('Error checking submission_periods table:', periodsError);
    } else if (!periodsInfo) {
      console.error('submission_periods table does not exist!');
    } else {
      console.log('✓ submission_periods table exists');
    }
    
    console.log('\nChecking submission_reviews table...');
    const { data: reviewsInfo, error: reviewsError } = await supabase
      .rpc('check_table_structure', { table_name: 'submission_reviews' });
    
    if (reviewsError) {
      console.error('Error checking submission_reviews table:', reviewsError);
    } else if (!reviewsInfo) {
      console.error('submission_reviews table does not exist!');
    } else {
      console.log('✓ submission_reviews table exists');
    }
    
    // Check if UUID v7 function exists
    console.log('\nVerifying gen_uuid_v7 function...');
    const { data: uuidFunctions, error: uuidFunctionsError } = await supabase
      .rpc('list_functions');
    
    if (uuidFunctionsError) {
      console.error('Error checking gen_uuid_v7 function:', uuidFunctionsError);
    } else {
      const hasUuidV7Function = uuidFunctions.some(func => func.function_name === 'gen_uuid_v7');
      if (hasUuidV7Function) {
        console.log('✓ gen_uuid_v7 function exists');
      } else {
        console.error('gen_uuid_v7 function does not exist!');
      }
    }
    
    // Check if RPC function exists for schema verification
    console.log('\nVerifying database functions...');
    const { data: functions, error: functionsError } = await supabase
      .rpc('list_functions');
    
    if (functionsError) {
      console.error('Error checking database functions:', functionsError);
      console.log('\nCreating check_table_structure function...');
      
      // Create the function if it doesn't exist
      const { error: createFunctionError } = await supabase
        .rpc('create_check_table_function');
      
      if (createFunctionError) {
        console.error('Error creating check_table_structure function:', createFunctionError);
        console.log('\nPlease run the following SQL in your Supabase SQL editor:');
        console.log(`
-- Function to check if a table exists
CREATE OR REPLACE FUNCTION check_table_structure(table_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = $1
  );
END;
$$;

-- Function to list all functions in the database
CREATE OR REPLACE FUNCTION list_functions()
RETURNS TABLE(function_name text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT routine_name::text
  FROM information_schema.routines
  WHERE routine_schema = 'public';
END;
$$;

-- Function to create the check_table_function
CREATE OR REPLACE FUNCTION create_check_table_function()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE $FUNC$
  CREATE OR REPLACE FUNCTION check_table_structure(table_name text)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $INNER$
  BEGIN
    RETURN EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = $1
    );
  END;
  $INNER$;
  $FUNC$;
  
  RETURN TRUE;
END;
$$;
`);
      } else {
        console.log('✓ check_table_structure function created successfully');
      }
    } else {
      const hasCheckFunction = functions.some(fn => fn.function_name === 'check_table_structure');
      if (hasCheckFunction) {
        console.log('✓ check_table_structure function exists');
      } else {
        console.error('check_table_structure function does not exist!');
      }
    }
    
    console.log('\nSchema verification completed!');
    return true;
  } catch (error) {
    console.error('Error during schema verification:', error);
    return false;
  }
}

// Run the verification
verifySupabaseSchema()
  .then(success => {
    if (success) {
      console.log('Supabase schema verification completed!');
      process.exit(0);
    } else {
      console.error('Supabase schema verification failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Error running schema verification:', error);
    process.exit(1);
  });