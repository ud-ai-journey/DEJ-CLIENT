# Review System ID Usage Guide

## Overview
The review system uses three distinct UUID identifiers for different purposes:

## 🆔 **Three Types of IDs**

### 1. **`id`** (Review Record ID)
- **Purpose**: Unique identifier for each individual review record
- **Type**: UUID (e.g., `2103108a-8247-4fdc-9582-eb3640d6fc56`)
- **Use Cases**:
  - Editing/updating a specific review
  - Direct access to review data
  - Tracking review history

### 2. **`submission_id`** (Submission UUID)  
- **Purpose**: Links review to the paper being reviewed
- **Type**: UUID (e.g., `6b8c311f-c29c-4f87-9685-835379...`)
- **Use Cases**:
  - Finding all reviews for a submission
  - Admin dashboard submission management
  - Reviewer dashboard filtering

### 3. **`reviewer_id`** (Reviewer UUID)
- **Purpose**: Links review to the assigned reviewer
- **Type**: UUID (e.g., `97bd6303-68f7-4a12-89c1-f5bacc...`)
- **Use Cases**:
  - Finding all reviews assigned to a reviewer
  - Reviewer dashboard view
  - Access control and permissions

## 🔧 **API Endpoints by ID Type**

### Using **Review ID** (`id`)
```javascript
// Get specific review for editing
GET /api/review/id/:reviewId
```

### Using **Submission ID** (`submission_id`)
```javascript
// Get review by submission + current user
GET /api/review/:submissionId

// Submit review for submission
POST /api/review/:submissionId

// Start reviewing submission  
POST /api/review/:submissionId/start

// Serve review form page
GET /review/:submissionId
```

### Using **Reviewer ID** (`reviewer_id`)
```javascript
// Get all reviews for current reviewer
GET /api/reviewer/reviews
```

## 🎯 **Database Query Patterns**

### Find Specific Review (submission + reviewer)
```sql
SELECT * FROM reviews 
WHERE submission_id = 'uuid' 
AND reviewer_id = 'uuid';
```

### Find All Reviews for Submission (admin view)
```sql
SELECT * FROM reviews 
WHERE submission_id = 'uuid'
ORDER BY assigned_at;
```

### Find All Reviews for Reviewer (reviewer dashboard)
```sql
SELECT * FROM reviews 
WHERE reviewer_id = 'uuid'
ORDER BY assigned_at DESC;
```

### Update Specific Review
```sql
UPDATE reviews 
SET status = 'COMPLETED', score = 8.5
WHERE id = 'review-uuid';
```

## 🚦 **Common Usage Scenarios**

### **Reviewer Dashboard**
1. Use `reviewer_id` to get all assigned reviews
2. Use `submission_id` to open specific review form
3. Use `id` for updating review status/data

### **Admin Dashboard**  
1. Use `submission_id` to see all reviews for a paper
2. Use `reviewer_id` to see reviewer workload
3. Use `id` for individual review management

### **Review Form**
1. URL uses `submission_id`: `/review/:submissionId`
2. Form finds review using `submission_id` + current user's `reviewer_id`
3. Updates use the review's `id`

## ⚠️ **Important Notes**

- **Never use `parseInt()`** on UUIDs - they're strings, not numbers
- All three IDs are UUIDs, handle as strings throughout the system
- Use appropriate ID type for the specific use case
- Composite keys (`submission_id` + `reviewer_id`) for finding assignments
- Single ID (`id`) for direct record operations

## 🔍 **Debugging Tips**

- Check which ID type you need for your use case
- Verify UUID string format (not truncated to numbers)  
- Use database logs to see actual query patterns
- Test with full UUID strings, not shortened versions