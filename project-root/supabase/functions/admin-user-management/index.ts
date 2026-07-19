import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

console.log("Admin User Management Edge Function started!")

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
    const userId = url.searchParams.get('userId')
    
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

    // Check if user has admin role (this would be stored in metadata or a separate roles table)
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
      case 'delete-user':
        return await handleDeleteUser(req, supabase, userId)
      
      case 'suspend-user':
        return await handleSuspendUser(req, supabase, userId)
      
      case 'reset-user-password':
        return await handleResetUserPassword(req, supabase, userId)
      
      case 'merge-user-accounts':
        return await handleMergeUserAccounts(req, supabase)
      
      case 'bulk-user-action':
        return await handleBulkUserAction(req, supabase)
      
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
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

// Handle user deletion (permanent removal)
async function handleDeleteUser(req: Request, supabase: any, userId: string) {
  if (req.method !== 'DELETE') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'User ID is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // Start transaction-like operations
    const deleteOperations = []

    // 1. Delete from submissions (or mark as deleted)
    deleteOperations.push(
      supabase
        .from('submissions')
        .update({ 
          status: 'deleted',
          metadata: supabase.raw(`COALESCE(metadata, '{}')::jsonb || '{"deleted_at": "${new Date().toISOString()}", "deletion_reason": "${reason}"}'::jsonb`)
        })
        .or(`owner_email.eq.${userId},first_author_email.eq.${userId}`)
    )

    // 2. Delete from authors table
    deleteOperations.push(
      supabase
        .from('authors')
        .delete()
        .eq('author_uid', userId)
    )

    // 3. Delete from reviewer_applications
    deleteOperations.push(
      supabase
        .from('reviewer_applications')
        .delete()
        .eq('id', userId)
    )

    // 4. Delete from account_emails
    deleteOperations.push(
      supabase
        .from('account_emails')
        .delete()
        .eq('account_uid', userId)
    )

    // Execute all operations
    const results = await Promise.all(deleteOperations)
    
    // Check for errors
    const hasError = results.some(result => result.error)
    if (hasError) {
      console.error('Error during user deletion:', results.map(r => r.error).filter(Boolean))
      return new Response(
        JSON.stringify({ error: 'Failed to delete user completely' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log the deletion for audit purposes
    await supabase
      .from('admin_audit_log')
      .insert({
        action: 'user_deleted',
        target_user_id: userId,
        admin_user_id: req.headers.get('X-Admin-User-ID'),
        reason: reason,
        timestamp: new Date().toISOString(),
        details: { confirmation: confirmDeletion }
      })
      .catch(err => console.warn('Failed to log audit:', err))

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'User deleted successfully',
        deletedAt: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error deleting user:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to delete user', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle user suspension
async function handleSuspendUser(req: Request, supabase: any, userId: string) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { reason, duration, suspensionType } = body

    // Update user status in all relevant tables
    const updateOperations = []

    // Update authors table
    updateOperations.push(
      supabase
        .from('authors')
        .update({
          metadata: supabase.raw(`COALESCE(metadata, '{}')::jsonb || '{"status": "suspended", "suspension_reason": "${reason}", "suspended_at": "${new Date().toISOString()}", "suspension_duration": "${duration || 'indefinite'}", "suspension_type": "${suspensionType || 'full'}"}'::jsonb`)
        })
        .eq('author_uid', userId)
    )

    // Update reviewer applications
    updateOperations.push(
      supabase
        .from('reviewer_applications')
        .update({ status: 'suspended' })
        .eq('id', userId)
    )

    const results = await Promise.all(updateOperations)
    
    const hasError = results.some(result => result.error)
    if (hasError) {
      console.error('Error during user suspension:', results.map(r => r.error).filter(Boolean))
      return new Response(
        JSON.stringify({ error: 'Failed to suspend user' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'User suspended successfully',
        suspendedAt: new Date().toISOString(),
        reason: reason
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error suspending user:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to suspend user', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle password reset
async function handleResetUserPassword(req: Request, supabase: any, userId: string) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { userEmail, sendEmail = true } = body

    if (!userEmail) {
      return new Response(
        JSON.stringify({ error: 'User email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use Supabase Admin API to reset password
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: userEmail,
    })

    if (error) {
      console.error('Error generating password reset link:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to generate password reset link' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Password reset link generated',
        resetLink: sendEmail ? null : data.properties.action_link // Only return link if email is not being sent
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error resetting user password:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to reset password', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle merging user accounts
async function handleMergeUserAccounts(req: Request, supabase: any) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { primaryUserId, duplicateUserId, mergeStrategy } = body

    if (!primaryUserId || !duplicateUserId) {
      return new Response(
        JSON.stringify({ error: 'Both primary and duplicate user IDs are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // This is a complex operation that would require careful implementation
    // For now, return a placeholder response
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: 'Account merging not yet implemented',
        requiresManualIntervention: true
      }),
      { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error merging user accounts:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to merge accounts', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle bulk user actions
async function handleBulkUserAction(req: Request, supabase: any) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { userIds, action, parameters } = body

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'User IDs array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (userIds.length > 100) {
      return new Response(
        JSON.stringify({ error: 'Maximum 100 users can be processed at once' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Process each user
    const results = []
    for (const userId of userIds) {
      try {
        switch (action) {
          case 'suspend':
            // Implement bulk suspension
            const suspendResult = await supabase
              .from('authors')
              .update({
                metadata: supabase.raw(`COALESCE(metadata, '{}')::jsonb || '{"status": "suspended", "bulk_action": true, "suspended_at": "${new Date().toISOString()}"}'::jsonb`)
              })
              .eq('author_uid', userId)
            
            results.push({
              userId,
              success: !suspendResult.error,
              error: suspendResult.error?.message
            })
            break
            
          default:
            results.push({
              userId,
              success: false,
              error: 'Unsupported bulk action'
            })
        }
      } catch (userError) {
        results.push({
          userId,
          success: false,
          error: userError.message
        })
      }
    }

    const successCount = results.filter(r => r.success).length
    const errorCount = results.filter(r => !r.success).length

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Bulk action completed: ${successCount} successful, ${errorCount} failed`,
        results: results,
        summary: {
          total: userIds.length,
          successful: successCount,
          failed: errorCount
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error performing bulk user action:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to perform bulk action', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}