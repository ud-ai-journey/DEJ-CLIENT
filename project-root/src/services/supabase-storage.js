import supabase from '../../config/supabase.js';
import dotenv from 'dotenv';

dotenv.config();

// Storage bucket names
const PAPER_BUCKET = 'papers';
const CV_BUCKET = 'cvs';

/**
 * Upload a file to Supabase Storage
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {string} fileName - The name to give the file in storage
 * @param {string} contentType - The MIME type of the file
 * @param {string} fileType - The type of file ('cv' or 'paper')
 * @returns {Promise<{url: string, key: string, bucket: string}>} - The URL and key of the uploaded file
 */
export async function uploadFile(fileBuffer, fileName, contentType, fileType = 'paper') {
  // Determine which bucket to use based on fileType
  const bucket = fileType.toLowerCase() === 'cv' ? CV_BUCKET : PAPER_BUCKET;
  
  try {
    // Create a unique name for the file
    const datePrefix = new Date().toISOString().slice(0, 10);
    const random = Math.random().toString(36).slice(2, 10);
    const storagePath = `${datePrefix}/${fileName}-${random}`;
    
    // Upload the file to Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, fileBuffer, {
        contentType,
        cacheControl: '3600'
      });
    
    if (error) {
      console.error('Error uploading file to Supabase Storage:', error);
      throw new Error('Failed to upload file to storage');
    }
    
    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(storagePath);
    
    // Return the URL and key
    return {
      url: urlData.publicUrl,
      key: storagePath,
      bucket: bucket
    };
  } catch (error) {
    console.error('Error uploading file to Supabase Storage:', error);
    throw new Error('Failed to upload file to storage');
  }
}

/**
 * Get a file from Supabase Storage
 * @param {string} storagePath - The path of the file in storage
 * @param {string} fileType - The type of file ('cv' or 'paper')
 * @returns {Promise<{data: ArrayBuffer, contentType: string}>} - The file data and content type
 */
export async function getFile(storagePath, fileType = 'paper') {
  // Determine which bucket to use based on fileType
  const bucket = fileType.toLowerCase() === 'cv' ? CV_BUCKET : PAPER_BUCKET;
  
  try {
    // Download the file from Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(storagePath);
    
    if (error) {
      console.error('Error downloading file from Supabase Storage:', error);
      throw new Error('Failed to download file from storage');
    }
    
    // Get the file metadata to determine content type
    const { data: metadata, error: metadataError } = await supabase.storage
      .from(bucket)
      .getPublicUrl(storagePath);
    
    if (metadataError) {
      console.error('Error getting file metadata from Supabase Storage:', metadataError);
    }
    
    // Return the file data and content type
    return {
      data: await data.arrayBuffer(),
      contentType: data.type || 'application/octet-stream'
    };
  } catch (error) {
    console.error('Error getting file from Supabase Storage:', error);
    throw new Error('Failed to get file from storage');
  }
}

/**
 * Delete a file from Supabase Storage
 * @param {string} storagePath - The path of the file in storage
 * @param {string} fileType - The type of file ('cv' or 'paper')
 * @returns {Promise<boolean>} - Whether the file was deleted successfully
 */
export async function deleteFile(storagePath, fileType = 'paper') {
  // Determine which bucket to use based on fileType
  const bucket = fileType.toLowerCase() === 'cv' ? CV_BUCKET : PAPER_BUCKET;
  
  try {
    // Delete the file from Supabase Storage
    const { error } = await supabase.storage
      .from(bucket)
      .remove([storagePath]);
    
    if (error) {
      console.error('Error deleting file from Supabase Storage:', error);
      throw new Error('Failed to delete file from storage');
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting file from Supabase Storage:', error);
    throw new Error('Failed to delete file from storage');
  }
}