import supabase from '../config/supabase.js';

/**
 * Diagnostic script to check the actual database schema
 */
async function checkDatabaseSchema() {
  console.log('🔍 Checking database schema...');

  try {
    // Check reviews table structure
    console.log('\n📋 Checking reviews table...');
    const { data: reviewsSchema, error: reviewsError } = await supabase
      .rpc('exec', { 
        query: `
          SELECT column_name, data_type, is_nullable 
          FROM information_schema.columns 
          WHERE table_name = 'reviews' 
          ORDER BY ordinal_position;
        `
      });

    if (!reviewsError && reviewsSchema) {
      console.log('Reviews table columns:');
      reviewsSchema.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    } else {
      console.log('Could not get reviews schema via RPC, trying direct query...');
      
      // Try a simple query to see what we get
      const { data: sampleReview, error: sampleError } = await supabase
        .from('reviews')
        .select('id, submission_id, reviewer_id, status')
        .limit(1);

      if (!sampleError && sampleReview) {
        console.log('Sample review data:', sampleReview[0]);
      } else {
        console.log('Sample review error:', sampleError);
      }
    }

    // Check submissions table structure
    console.log('\n📄 Checking submissions table...');
    const { data: submissionsSchema, error: submissionsError } = await supabase
      .rpc('exec', { 
        query: `
          SELECT column_name, data_type, is_nullable 
          FROM information_schema.columns 
          WHERE table_name = 'submissions' 
          ORDER BY ordinal_position;
        `
      });

    if (!submissionsError && submissionsSchema) {
      console.log('Submissions table columns:');
      submissionsSchema.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    }

    // Try to check for any existing reviews
    console.log('\n🔍 Checking existing reviews...');
    const { data: existingReviews, error: existingError } = await supabase
      .from('reviews')
      .select('id, submission_id, reviewer_id, status')
      .limit(5);

    if (!existingError && existingReviews) {
      console.log('Existing reviews:');
      existingReviews.forEach(review => {
        console.log(`  - Review ${review.id}: submission_id=${review.submission_id} (type: ${typeof review.submission_id}), reviewer_id=${review.reviewer_id} (type: ${typeof review.reviewer_id})`);
      });
    } else {
      console.log('Error getting existing reviews:', existingError);
    }

  } catch (error) {
    console.error('❌ Error checking database schema:', error);
  }
}

// Run the diagnostic if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  checkDatabaseSchema()
    .then(() => {
      console.log('\n✅ Schema check completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Schema check failed:', error);
      process.exit(1);
    });
}

export { checkDatabaseSchema };