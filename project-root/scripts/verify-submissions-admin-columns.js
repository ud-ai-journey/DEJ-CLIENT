import supabase from '../config/supabase.js';
import dotenv from 'dotenv';

dotenv.config();

async function verifySubmissionsAdminColumns() {
  console.log('Verifying submissions admin columns (rejected_by, rejected_at, rejection_comments)...');
  if (!supabase) {
    console.error('Supabase client not initialized. Ensure SUPABASE_URL and SUPABASE_KEY are set.');
    process.exit(1);
  }

  try {
    // Try selecting the columns to force PostgREST to validate its schema cache
    const { data, error } = await supabase
      .from('submissions')
      .select('id, rejected_by, rejected_at, rejection_comments')
      .limit(1);

    if (error) {
      console.error('\nFAIL: Could not select expected columns from submissions');
      console.error('Error:', error);

      if (error.code === 'PGRST204') {
        console.log('\nHint: This often means the API schema cache is stale. Options:');
        console.log('- Run SQL: NOTIFY pgrst, \"reload schema\"; in Supabase SQL editor');
        console.log('- Or in the repo SQL: scripts/update-submissions-admin-columns.sql (already includes reload)');
        console.log('- Or reload the API schema from Supabase Dashboard > API > Reset/Reload cache');
      }
      process.exit(1);
    }

    console.log('\nPASS: Columns are queryable via the API.');
    if (data && data.length > 0) {
      console.log('Sample row keys:', Object.keys(data[0]));
    } else {
      console.log('No rows returned; structure verified.');
    }
    process.exit(0);
  } catch (e) {
    console.error('Unexpected error:', e);
    process.exit(1);
  }
}

verifySubmissionsAdminColumns();
