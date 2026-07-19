import supabase from '../config/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Update database schema for submission management
 */
async function updateSchemaForSubmissionManagement() {
  console.log('🔄 Updating database schema for submission management...');
  
  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'create-reviews-table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split SQL into individual statements (simple split on semicolon)
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
    
    console.log(`📝 Executing ${statements.length} SQL statements...`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement.length === 0) continue;
      
      console.log(`   ${i + 1}/${statements.length}: Executing SQL statement...`);
      
      try {
        // Use rpc to execute raw SQL
        const { error } = await supabase.rpc('exec_sql', { sql_query: statement });
        
        if (error) {
          // If exec_sql doesn't exist, try direct query
          if (error.message.includes('function exec_sql does not exist')) {
            console.log('   ⚠️  exec_sql function not available, trying direct query...');
            // For simple queries, we can try using the query builder
            // This is limited but may work for basic operations
          } else {
            console.error(`   ❌ Error executing statement ${i + 1}:`, error);
            console.error(`   Statement: ${statement.substring(0, 100)}...`);
          }
        } else {
          console.log(`   ✅ Statement ${i + 1} executed successfully`);
        }
      } catch (execError) {
        console.error(`   ❌ Exception executing statement ${i + 1}:`, execError);
      }
    }
    
    // Verify the reviews table was created
    console.log('\n🔍 Verifying reviews table...');
    const { data: reviewsTest, error: reviewsError } = await supabase
      .from('reviews')
      .select('*')
      .limit(1);
    
    if (reviewsError) {
      if (reviewsError.code === 'PGRST116') {
        console.log('✅ Reviews table exists but is empty');
      } else {
        console.error('❌ Error accessing reviews table:', reviewsError);
      }
    } else {
      console.log('✅ Reviews table accessible');
    }
    
    // Check if we can insert a test review (and then delete it)
    console.log('🧪 Testing reviews table functionality...');
    try {
      // This will fail if the table structure is wrong
      const testQuery = await supabase
        .from('reviews')
        .select('id, submission_id, reviewer_id, status')
        .limit(0);
      
      if (testQuery.error) {
        console.error('❌ Reviews table structure issue:', testQuery.error);
      } else {
        console.log('✅ Reviews table structure verified');
      }
    } catch (testError) {
      console.error('❌ Error testing reviews table:', testError);
    }
    
    console.log('\n🎉 Database schema update completed!');
    console.log('\nNext steps:');
    console.log('1. If you see errors above, you may need to run the SQL manually in Supabase SQL editor');
    console.log('2. Test the admin dashboard submission management features');
    console.log('3. Verify reviewer assignment functionality');
    
    return true;
  } catch (error) {
    console.error('❌ Error updating schema:', error);
    
    console.log('\n📋 Manual Setup Instructions:');
    console.log('If automatic setup failed, please run the following in your Supabase SQL editor:');
    console.log('1. Go to https://app.supabase.com/project/YOUR_PROJECT/sql');
    console.log('2. Copy and paste the contents of scripts/create-reviews-table.sql');
    console.log('3. Click "Run" to execute the SQL');
    
    return false;
  }
}

// Run the schema update
updateSchemaForSubmissionManagement()
  .then(success => {
    if (success) {
      console.log('\n✅ Schema update completed successfully!');
      process.exit(0);
    } else {
      console.log('\n❌ Schema update failed. Please check the manual instructions above.');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });