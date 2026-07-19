import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

console.log("Admin Submissions Edge Function started!")

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Parse the request
    const url = new URL(req.url)
    const method = req.method
    const pathSegments = url.pathname.split('/').filter(Boolean)
    
    // Extract operation and parameters
    const operation = pathSegments[pathSegments.length - 1] || url.searchParams.get('operation')
    const submissionId = url.searchParams.get('submissionId')
    
    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Verify the JWT token and get user info
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token or user not found' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Verify admin privileges
    const { data: adminAccount, error: adminError } = await supabase
      .from('account_emails')
      .select('*, metadata')
      .eq('auth_user_id', user.id)
      .single()

    if (adminError || !adminAccount) {
      return new Response(
        JSON.stringify({ error: 'Admin account not found' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check if user has admin role
    const userRole = adminAccount.metadata?.role || 'user'
    if (userRole !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Insufficient privileges - admin access required' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Handle different operations
    switch (operation) {
      case 'force-reject':
        return await handleForceReject(req, supabase, submissionId)
      
      case 'force-accept':
        return await handleForceAccept(req, supabase, submissionId)
      
      case 'delete-submission':
        return await handleDeleteSubmission(req, supabase, submissionId)
      
      case 'assign-emergency-reviewer':
        return await handleAssignEmergencyReviewer(req, supabase, submissionId)
      
      case 'extend-review-deadline':
        return await handleExtendReviewDeadline(req, supabase, submissionId)
      
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid operation' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
    }

  } catch (error) {
    console.error('Edge Function Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

// Force reject a submission (admin override)
async function handleForceReject(req: Request, supabase: any, submissionId: string) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!submissionId) {
    return new Response(
      JSON.stringify({ error: 'Submission ID is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { reason, adminOverride } = body

    if (!adminOverride) {
      return new Response(
        JSON.stringify({ error: 'Admin override confirmation required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update submission status with admin override
    const { data, error } = await supabase
      .from('submissions')
      .update({
        status: 'rejected',
        metadata: supabase.raw(`COALESCE(metadata, '{}')::jsonb || '{"admin_override": true, "admin_rejection_reason": "${reason}", "rejected_at": "${new Date().toISOString()}", "rejected_by": "admin"}'::jsonb`),
        updated_at: new Date().toISOString()
      })
      .eq('id', submissionId)
      .select()
      .single()

    if (error) {
      console.error('Error rejecting submission:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to reject submission' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Submission forcefully rejected by admin',
        submission: data,
        rejectedAt: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in force reject:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to reject submission' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Force accept a submission (admin override)
async function handleForceAccept(req: Request, supabase: any, submissionId: string) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { reason, adminOverride, publicationDate } = body

    if (!adminOverride) {
      return new Response(
        JSON.stringify({ error: 'Admin override confirmation required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update submission status with admin override
    const { data, error } = await supabase
      .from('submissions')
      .update({
        status: 'accepted',
        metadata: supabase.raw(`COALESCE(metadata, '{}')::jsonb || '{"admin_override": true, "admin_acceptance_reason": "${reason}", "accepted_at": "${new Date().toISOString()}", "accepted_by": "admin", "planned_publication_date": "${publicationDate || ''}"}'::jsonb`),
        updated_at: new Date().toISOString()
      })
      .eq('id', submissionId)
      .select()
      .single()

    if (error) {
      console.error('Error accepting submission:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to accept submission' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Submission forcefully accepted by admin',
        submission: data,
        acceptedAt: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in force accept:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to accept submission' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Delete a submission permanently (admin only)
async function handleDeleteSubmission(req: Request, supabase: any, submissionId: string) {
  if (req.method !== 'DELETE') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { reason, confirmDeletion } = body

    if (!confirmDeletion) {
      return new Response(
        JSON.stringify({ error: 'Deletion confirmation required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // First, archive the submission data
    const { data: submissionData } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .single()

    if (submissionData) {
      // Store in admin_deleted_submissions table (if it exists)
      await supabase
        .from('admin_deleted_submissions')
        .insert({
          original_submission_id: submissionId,
          submission_data: submissionData,
          deletion_reason: reason,
          deleted_at: new Date().toISOString(),
          deleted_by: 'admin'
        })
        .catch(err => console.warn('Failed to archive submission:', err))
    }

    // Delete the submission
    const { error } = await supabase
      .from('submissions')
      .delete()
      .eq('id', submissionId)

    if (error) {
      console.error('Error deleting submission:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to delete submission' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Submission deleted successfully',
        deletedAt: new Date().toISOString(),
        archived: !!submissionData
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error deleting submission:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to delete submission' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Assign emergency reviewer
async function handleAssignEmergencyReviewer(req: Request, supabase: any, submissionId: string) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { reviewerId, deadline, reason } = body

    if (!reviewerId) {
      return new Response(
        JSON.stringify({ error: 'Reviewer ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // This would require the reviews table to be implemented
    // For now, update submission metadata
    const { data, error } = await supabase
      .from('submissions')
      .update({
        metadata: supabase.raw(`COALESCE(metadata, '{}')::jsonb || '{"emergency_reviewer": "${reviewerId}", "emergency_assignment_reason": "${reason}", "emergency_deadline": "${deadline}", "assigned_at": "${new Date().toISOString()}"}'::jsonb`),
        updated_at: new Date().toISOString()
      })
      .eq('id', submissionId)
      .select()
      .single()

    if (error) {
      console.error('Error assigning emergency reviewer:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to assign emergency reviewer' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Emergency reviewer assigned successfully',
        submission: data
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error assigning emergency reviewer:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to assign emergency reviewer' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Extend review deadline
async function handleExtendReviewDeadline(req: Request, supabase: any, submissionId: string) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { newDeadline, reason } = body

    if (!newDeadline) {
      return new Response(
        JSON.stringify({ error: 'New deadline is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update submission metadata with extended deadline
    const { data, error } = await supabase
      .from('submissions')
      .update({
        metadata: supabase.raw(`COALESCE(metadata, '{}')::jsonb || '{"extended_deadline": "${newDeadline}", "deadline_extension_reason": "${reason}", "deadline_extended_at": "${new Date().toISOString()}"}'::jsonb`),
        updated_at: new Date().toISOString()
      })
      .eq('id', submissionId)
      .select()
      .single()

    if (error) {
      console.error('Error extending deadline:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to extend deadline' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Review deadline extended successfully',
        submission: data,
        newDeadline: newDeadline
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error extending deadline:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to extend deadline' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}