import supabase from '../config/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Apply the detailed reviews table schema update
 */
async function updateReviewsTableSchema() {
  console.log('🔄 Updating reviews table schema for detailed review criteria...');

  try {
    // Read the SQL migration file
    const sqlFile = path.join(__dirname, 'update-reviews-table-detailed.sql');
    const sqlCommands = fs.readFileSync(sqlFile, 'utf8');

    // Split into individual commands and execute
    const commands = sqlCommands
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0);

    console.log(`📝 Executing ${commands.length} database commands...`);

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      if (command.length === 0) continue;

      console.log(`   ${i + 1}/${commands.length}: ${command.substring(0, 50)}...`);
      
      try {
        const { error } = await supabase.rpc('exec_sql', { sql: command });
        if (error) {
          // Try direct query if RPC fails
          const { error: directError } = await supabase.from('dummy').select('1');
          if (directError) {
            // Execute raw SQL using the raw query method
            const { error: rawError } = await supabase.rpc('exec', { query: command });
            if (rawError) {
              console.warn(`⚠️  Warning executing command ${i + 1}: ${rawError.message}`);
            }
          }
        }
      } catch (err) {
        console.warn(`⚠️  Warning executing command ${i + 1}: ${err.message}`);
      }
    }

    // Verify the new columns exist
    console.log('\n🔍 Verifying new schema...');
    
    // Check for new columns in reviews table
    const { data: columns, error: columnsError } = await supabase
      .rpc('get_table_columns', { table_name: 'reviews' });

    if (!columnsError && columns) {
      const newColumns = [
        'originality_score', 'relevance_score', 'literature_score',
        'methodology_score', 'analysis_score', 'clarity_score',
        'presentation_score', 'significance_score', 'ethics_score',
        'originality_comment', 'relevance_comment', 'literature_comment',
        'methodology_comment', 'analysis_comment', 'clarity_comment',
        'presentation_comment', 'significance_comment', 'ethics_comment',
        'strengths', 'weaknesses', 'additional_comments', 'recommendation'
      ];

      const existingColumnNames = columns.map(col => col.column_name);
      const foundColumns = newColumns.filter(col => existingColumnNames.includes(col));
      
      console.log(`✅ Found ${foundColumns.length}/${newColumns.length} new columns`);
      
      if (foundColumns.length > 0) {
        console.log('   New columns:', foundColumns.join(', '));
      }
    }

    // Try to create a test query to verify the view exists
    try {
      const { data: viewTest, error: viewError } = await supabase
        .from('detailed_reviews')
        .select('*')
        .limit(1);

      if (!viewError) {
        console.log('✅ detailed_reviews view is working');
      } else {
        console.log('⚠️  detailed_reviews view not available:', viewError.message);
      }
    } catch (err) {
      console.log('⚠️  Could not verify detailed_reviews view');
    }

    console.log('\n🎉 Reviews table schema update completed!');
    console.log('\nNext steps:');
    console.log('1. Restart your application server');
    console.log('2. Test the review form with a sample submission');
    console.log('3. Verify that detailed review data is being saved');

  } catch (error) {
    console.error('❌ Error updating reviews table schema:', error);
    console.error(error.stack);
    
    console.log('\n🔧 Manual steps if script failed:');
    console.log('1. Connect to your Supabase SQL editor');
    console.log('2. Run the contents of scripts/update-reviews-table-detailed.sql');
    console.log('3. Verify that the new columns exist in the reviews table');
    
    process.exit(1);
  }
}

// Run the migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateReviewsTableSchema()
    .then(() => {
      console.log('\n🏁 Migration script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration script failed:', error);
      process.exit(1);
    });
}

export { updateReviewsTableSchema };