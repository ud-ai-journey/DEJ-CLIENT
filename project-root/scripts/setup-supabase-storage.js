import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Setup Supabase storage buckets for the application
 */
async function setupSupabaseStorage() {
  console.log('Setting up Supabase storage buckets...');
  
  try {
    // Create papers bucket if it doesn't exist
    console.log('Creating papers bucket...');
    const { data: papersBucket, error: papersError } = await supabase
      .storage
      .createBucket('papers', {
        public: false,
        fileSizeLimit: 26214400, // 25MB
        allowedMimeTypes: ['application/pdf']
      });
    
    if (papersError) {
      if (papersError.message.includes('already exists')) {
        console.log('Papers bucket already exists');
      } else {
        console.error('Error creating papers bucket:', papersError);
      }
    } else {
      console.log('Papers bucket created successfully');
    }
    
    // Create CVs bucket if it doesn't exist
    console.log('\nCreating CVs bucket...');
    const { data: cvsBucket, error: cvsError } = await supabase
      .storage
      .createBucket('cvs', {
        public: false,
        fileSizeLimit: 5242880, // 5MB
        allowedMimeTypes: ['application/pdf']
      });
    
    if (cvsError) {
      if (cvsError.message.includes('already exists')) {
        console.log('CVs bucket already exists');
      } else {
        console.error('Error creating CVs bucket:', cvsError);
      }
    } else {
      console.log('CVs bucket created successfully');
    }
    
    // List all buckets to verify
    console.log('\nListing all buckets:');
    const { data: buckets, error: listError } = await supabase
      .storage
      .listBuckets();
    
    if (listError) {
      console.error('Error listing buckets:', listError);
    } else {
      buckets.forEach(bucket => {
        console.log(`- ${bucket.name} (${bucket.public ? 'public' : 'private'})`);
      });
    }
    
    console.log('\nStorage setup completed successfully!');
    return true;
  } catch (error) {
    console.error('Error during storage setup:', error);
    return false;
  }
}

// Run the setup
setupSupabaseStorage()
  .then(success => {
    if (success) {
      console.log('Supabase storage setup completed successfully!');
      process.exit(0);
    } else {
      console.error('Supabase storage setup failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Error running storage setup:', error);
    process.exit(1);
  });