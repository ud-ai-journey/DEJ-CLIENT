# Supabase Edge Functions for Admin Management

This directory contains Supabase Edge Functions that provide secure, server-side operations for admin management in the Digital Evolution Journal system.

## Functions Overview

### 1. admin-user-management
**Path**: `/functions/v1/admin-user-management`
**Purpose**: Secure user management operations that require elevated privileges

**Operations**:
- `delete-user`: Permanently delete a user and all associated data
- `suspend-user`: Suspend user account with reason tracking
- `reset-user-password`: Generate password reset links for users
- `merge-user-accounts`: Merge duplicate user accounts (placeholder)
- `bulk-user-action`: Perform actions on multiple users simultaneously

**Security**: Requires valid JWT token and admin role verification

### 2. admin-submissions
**Path**: `/functions/v1/admin-submissions`
**Purpose**: Administrative operations on submissions that bypass normal workflow

**Operations**:
- `force-reject`: Admin override to reject submission regardless of review status
- `force-accept`: Admin override to accept submission regardless of review status
- `delete-submission`: Permanently delete submission with archival
- `assign-emergency-reviewer`: Assign reviewer outside normal process
- `extend-review-deadline`: Extend review deadlines for submissions

**Security**: Requires valid JWT token and admin role verification

## Deployment

### Prerequisites
1. Supabase CLI installed
2. Project linked to Supabase
3. Environment variables configured:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

### Deploy Commands
```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy admin-user-management
supabase functions deploy admin-submissions
```

### Local Development
```bash
# Start local development server
supabase functions serve

# Test specific function
supabase functions serve admin-user-management --env-file .env.local
```

## Usage Examples

### User Management

#### Delete User
```javascript
const response = await fetch('/functions/v1/admin-user-management?operation=delete-user&userId=user123', {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'Spam account',
    confirmDeletion: true
  })
});
```

#### Suspend User
```javascript
const response = await fetch('/functions/v1/admin-user-management?operation=suspend-user&userId=user123', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'Policy violation',
    duration: '30 days',
    suspensionType: 'partial'
  })
});
```

### Submission Management

#### Force Reject Submission
```javascript
const response = await fetch('/functions/v1/admin-submissions?operation=force-reject&submissionId=sub123', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'Does not meet journal standards',
    adminOverride: true
  })
});
```

#### Assign Emergency Reviewer
```javascript
const response = await fetch('/functions/v1/admin-submissions?operation=assign-emergency-reviewer&submissionId=sub123', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reviewerId: 'reviewer456',
    deadline: '2024-01-15',
    reason: 'Original reviewer unavailable'
  })
});
```

## Security Features

1. **JWT Authentication**: All requests must include valid JWT token
2. **Admin Role Verification**: Functions verify admin privileges before execution
3. **Audit Logging**: Administrative actions are logged for accountability
4. **CORS Protection**: Proper CORS headers for secure cross-origin requests
5. **Input Validation**: All inputs are validated before processing
6. **Error Handling**: Comprehensive error handling with appropriate HTTP status codes

## Error Responses

Standard error response format:
```json
{
  "error": "Error description",
  "details": "Additional error details (optional)"
}
```

Common HTTP status codes:
- `401`: Unauthorized (invalid or missing token)
- `403`: Forbidden (insufficient privileges)
- `400`: Bad Request (invalid parameters)
- `404`: Not Found (resource not found)
- `405`: Method Not Allowed (wrong HTTP method)
- `500`: Internal Server Error

## Environment Variables

Required environment variables for Edge Functions:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Database Requirements

The Edge Functions expect certain database structures:

1. **account_emails** table with `auth_user_id` and `metadata` fields
2. **submissions** table with standard fields and `metadata` JSONB field
3. **authors** table with `metadata` JSONB field
4. **reviewer_applications** table with standard fields

Optional tables for enhanced functionality:
- **admin_audit_log**: For logging administrative actions
- **admin_deleted_submissions**: For archiving deleted submissions

## Best Practices

1. **Always verify admin privileges** before executing sensitive operations
2. **Log all administrative actions** for audit purposes
3. **Validate all inputs** to prevent injection attacks
4. **Use transactions** for operations affecting multiple tables
5. **Provide clear error messages** while avoiding information disclosure
6. **Archive data** before deletion for recovery purposes

## Monitoring and Maintenance

1. **Monitor function logs** in Supabase dashboard
2. **Set up alerts** for function failures
3. **Regularly review audit logs** for suspicious activity
4. **Update dependencies** periodically
5. **Test functions** after Supabase platform updates