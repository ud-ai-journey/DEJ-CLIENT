import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import openid from 'express-openid-connect';
const { auth, requiresAuth } = openid;
import multer from 'multer';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import supabase from './config/supabase.js';
import { getReviewerApplications, getReviewerApplicationByUserId, getReviewerApplicationByEmail, createReviewerApplication, getReviewerProfileByUserId } from './src/services/reviewer-service.js';
import { getAccountByEmail } from './src/services/account-service.js';
import { getSubmissionById } from './src/services/submission-service.js';
// Load environment variables
dotenv.config();
console.log('Loaded environment variables');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from public directory only
app.use(express.static(path.join(__dirname, 'src', 'public')));
app.use(express.json());

// Multer config
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Auth0 config
const hasAuthConfig = Boolean(
  process.env.AUTH0_SECRET &&
  process.env.AUTH0_CLIENT_ID &&
  process.env.AUTH0_CLIENT_SECRET &&
  process.env.AUTH0_DOMAIN
);

console.log('Auth0 Configuration Status:', {
  hasConfig: hasAuthConfig,
  secret: Boolean(process.env.AUTH0_SECRET),
  clientId: Boolean(process.env.AUTH0_CLIENT_ID),
  clientSecret: Boolean(process.env.AUTH0_CLIENT_SECRET),
  domain: Boolean(process.env.AUTH0_DOMAIN),
  baseURL: process.env.AUTH0_BASE_URL
});

// Use cookieParser for other cookies if needed
app.use(cookieParser());

// Auth0 is required for production
if (!hasAuthConfig && process.env.NODE_ENV === 'production') {
  console.warn('Auth0 is not configured but required for production. Authentication will not work properly.');
}

// --- Auth0 configuration ---
if (hasAuthConfig) {
  const authConfig = {
    authRequired: false,
    secret: process.env.AUTH0_SECRET,
    baseURL: process.env.AUTH0_BASE_URL || `http://localhost:${PORT}`,
    clientID: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL || `https://${process.env.AUTH0_DOMAIN}`,
    auth0Logout: true,
    authorizationParams: { response_type: 'code', scope: 'openid profile email' }
  };
  
  console.log('Configuring Auth0 with:', {
    baseURL: authConfig.baseURL,
    issuerBaseURL: authConfig.issuerBaseURL
  });
  
  app.use(auth(authConfig));

  // Use Supabase for user management with email as main identifier
  app.use(async (req, _res, next) => {
    try {
      if (req.oidc?.isAuthenticated() && req.oidc.user?.email) {
        const { sub, email, name } = req.oidc.user;
        // Account service is already imported at the top of the file
        const { createAccount } = await import('./src/services/account-service.js');
        
        // Check if account exists by email (primary identifier)
        let account = await getAccountByEmail(email);
        if (!account) {
          // Create account if it doesn't exist, using email as primary and Auth0 ID as secondary
          account = await createAccount(email, sub);
        }
      }
    } catch (e) {
      console.error('User persistence error:', e);
    } finally { next(); }
  });
} else {
  console.warn('Auth0 env not configured; authentication is disabled.');
}
// --- End Auth0 configuration ---

// Auth0 logout endpoint
app.get('/api/logout', (req, res) => {
  if (!hasAuthConfig) {
    console.error('Auth0 is not configured but required for logout');
    return res.status(500).send('Authentication system not configured');
  }
  
  try {
    if (!res.oidc) {
      console.error('Logout error: res.oidc is undefined');
      return res.status(500).send('Authentication system error');
    }
    res.oidc.logout({ returnTo: '/' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).send('Logout failed');
  }
});

// --- Protect routes using Auth0 ---
const protectedPages = [
  'reviewer',
  'submit',
  'dashboard/author',
  'dashboard/reviewer'
];

const pageAuthMiddleware = hasAuthConfig ? requiresAuth() : (req, res, next) => next();

protectedPages.forEach(page => {
  app.get(`/${page}`, pageAuthMiddleware, (req, res) => {
    const file = page.includes('dashboard') ? `${page.replace('/', '-')}.html` : `${page}.html`;
    res.sendFile(path.join(__dirname, 'src', 'views', file));
  });
});

// --- Login and register routes now handled by Auth0 ---
app.get('/login', (req, res) => {
  if (!hasAuthConfig) {
    return res.sendFile(path.join(__dirname, 'src', 'views', 'login.html'));
  }
  
  const returnTo = req.query.next || '/dashboard/author';
  try {
    if (!res.oidc) {
      console.error('Login error: res.oidc is undefined');
      return res.status(500).send('Authentication system error. Please try again later.');
    }
    res.oidc.login({ returnTo });
  } catch (error) {
    console.error('Login error:', error);
    res.redirect('/?error=login_failed');
  }
});

app.get('/register', (req, res) => {
  if (!hasAuthConfig) {
    return res.sendFile(path.join(__dirname, 'src', 'views', 'register.html'));
  }

  const returnTo = '/dashboard/author';
  try {
    if (!res.oidc) {
      console.error('Register error: res.oidc is undefined');
      return res.status(500).send('Authentication system error. Please try again later.');
    }
    res.oidc.login({ returnTo, authorizationParams: { screen_hint: 'signup' } });
  } catch (error) {
    console.error('Register error:', error);
    res.redirect('/?error=registration_failed');
  }
});

// Auth helpers
const maybeAuth = () => (hasAuthConfig ? requiresAuth() : (_req, _res, next) => next());

const requireAuthApi = (req, res, next) => {
  // Require Auth0 to be configured
  if (!hasAuthConfig) {
    console.error('Auth0 is not configured but required for API authentication');
    return res.status(401).json({ error: 'Authentication system not configured' });
  }
  
  try {
    if (!req.oidc || !req.oidc.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

const ADMIN_TOKEN_PREFIX = 'admin-session-loratech-';
const ADMIN_FALLBACK_EMAIL = process.env.ADMIN_FALLBACK_EMAIL || 'admin@system';

const extractAdminEmailFromHeaders = (req) => {
  const headerEmail = req.headers['x-admin-email'] || req.headers['admin-email'];
  return headerEmail ? headerEmail.toString().trim() : null;
};

const attachAdminContext = (req, context) => {
  req.adminContext = {
    method: context.method,
    email: context.email ? context.email.toLowerCase() : null,
    name: context.name || null,
    token: context.token || null,
    subject: context.subject || null
  };
};

const getAdminEmail = (req) => req.adminContext?.email || ADMIN_FALLBACK_EMAIL;

// Admin API middleware with dual authentication support
const requireAdminAuthApi = (req, res, next) => {
  console.log(`Admin API request: ${req.method} ${req.path}`);
  
  // Method 1: Check for admin session token (for dashboard compatibility)
  const adminToken = req.headers['admin-token'] || req.query.adminToken;
  if (adminToken) {
    const expectedToken = ADMIN_TOKEN_PREFIX + new Date().toDateString();
    if (adminToken === expectedToken) {
      console.log('Admin API access granted via token for:', req.path);
      const tokenEmail = extractAdminEmailFromHeaders(req) || ADMIN_FALLBACK_EMAIL;
      attachAdminContext(req, {
        method: 'token',
        email: tokenEmail,
        token: adminToken
      });
      return next();
    }
  }
  
  // Method 2: Check Auth0 authentication with admin role (fallback)
  if (hasAuthConfig && req.oidc && req.oidc.isAuthenticated() && req.oidc.user) {
    // For now, allow any authenticated user to access admin endpoints
    // In production, you would check for admin role here
    console.log('Admin API access granted via Auth0 for:', req.path);
    const { email, name, sub } = req.oidc.user;
    attachAdminContext(req, {
      method: 'auth0',
      email: email || ADMIN_FALLBACK_EMAIL,
      name,
      subject: sub
    });
    return next();
  }
  
  // If no valid authentication found
  return res.status(401).json({
    success: false,
    error: 'Admin authentication required',
    code: 'AUTH_REQUIRED'
  });
};

// Input validation middleware for API parameters
const validateApiParams = (req, res, next) => {
  try {
    // Validate pagination parameters
    if (req.query.page) {
      const page = parseInt(req.query.page);
      if (isNaN(page) || page < 1 || page > 10000) {
        return res.status(400).json({
          success: false,
          error: 'Invalid page parameter (1-10000)',
          code: 'INVALID_PAGE'
        });
      }
      req.query.page = page;
    }
    
    // Validate limit parameters
    if (req.query.limit) {
      const limit = parseInt(req.query.limit);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        return res.status(400).json({
          success: false,
          error: 'Invalid limit parameter (1-1000)',
          code: 'INVALID_LIMIT'
        });
      }
      req.query.limit = limit;
    }
    
    // Validate status parameters
    if (req.query.status) {
      const status = req.query.status.toString();
      if (status.length > 50) {
        return res.status(400).json({
          success: false,
          error: 'Status parameter too long',
          code: 'INVALID_STATUS'
        });
      }
    }
    
    // Validate search parameters
    if (req.query.search) {
      const search = req.query.search.toString();
      if (search.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Search parameter too long',
          code: 'INVALID_SEARCH'
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Parameter validation error:', error);
    return res.status(400).json({
      success: false,
      error: 'Invalid request parameters',
      code: 'VALIDATION_ERROR'
    });
  }
};

// HTML page routes
app.get(['/', '/index', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'index.html'));
});

// Admin login routes (both with and without .html extension)
app.get(['/admin-login', '/admin-login.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'admin-login.html'));
});

// Admin submission detail page
app.get('/admin/submissions/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'admin-submission-detail.html'));
});

// Admin submissions list page
app.get('/admin/submissions', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'admin-submissions-list.html'));
});

// Admin published submissions page
app.get('/admin/published', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'admin-published-list.html'));
});

// Admin author profile page
app.get('/admin/authors/:email', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'admin-author-profile.html'));
});

// Admin authors list page
app.get('/admin/authors', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'admin-authors-list.html'));
});

// Legacy alias for authors list (singular path)
app.get('/admin/author', (_req, res) => {
  res.redirect('/admin/authors');
});

// Admin reviewers list page
app.get(['/admin/reviewers', '/admin/reviewers.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'admin-reviewers.html'));
});

// Admin dashboard home (clean admin UI)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'admin-dashboard-home.html'));
});

app.get('/author-guidelines.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'author-guidelines.html'));
});

app.get('/publication-ethics.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'publication-ethics.html'));
});

app.get('/review-guidelines.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'review-guidelines.html'));
});

app.get('/formatting-guide.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'formatting-guide.html'));
});

app.get('/reviewer-ethics.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'reviewer-ethics.html'));
});

// app.get('/training-materials.html', (req, res) => {
//   res.sendFile(path.join(__dirname, 'src', 'views', 'training-materials.html'));
// });

app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'about.html'));
});

app.get('/researches', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'researches.html'));
});

// Route for paper detail page
app.get('/paper-detail.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'views', 'paper-detail.html'));
});

// Auth info for frontend
app.get('/api/me', async (req, res) => {
  if (!hasAuthConfig) {
    console.warn('Auth0 is not configured, user will not be authenticated');
    return res.json({ isAuthenticated: false, authConfigured: false });
  }
  
  try {
    if (req.oidc && req.oidc.isAuthenticated() && req.oidc.user) {
      // Get account by email (primary identifier)
      const account = await getAccountByEmail(req.oidc.user.email);
      
      return res.json({
        isAuthenticated: true,
        authConfigured: true,
        user: {
          id: account ? account.id : null, // Use database ID instead of Auth0 ID
          email: req.oidc.user.email,
          name: req.oidc.user.name,
          role: req.oidc.user.role || 'author'
        }
      });
    }
    return res.json({ isAuthenticated: false, authConfigured: true });
  } catch (error) {
    console.error('Error in /api/me endpoint:', error);
    return res.json({ isAuthenticated: false, authConfigured: true, error: 'Authentication error' });
  }
});

// Public API endpoint for published submissions
app.get('/api/published', async (req, res) => {
  try {
    const {
      search,
      paper_type,
      author_email,
      date_range,
      sort_by,
      page = 1,
      limit = 20
    } = req.query;

    const parsedLimit = Number.parseInt(limit, 10) || 20;
    const parsedPage = Number.parseInt(page, 10) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    const filters = {
      search: search?.trim() || undefined,
      status: 'published', // Only published submissions
      paper_type: paper_type || undefined,
      author_email: author_email?.trim() || undefined,
      date_range: date_range || undefined,
      sort_by: sort_by || 'published_at_desc'
    };

    const result = await getSubmissionsForAdmin(
      filters, 
      parsedLimit, 
      offset,
      'public@system' // Use a system email for public access
    );

    const { data: submissions, pagination: resultPagination } = result;
    const total = resultPagination.total;
    const totalPages = Math.ceil(total / parsedLimit);

    const pagination = {
      current_page: parsedPage,
      total_pages: totalPages,
      total_items: total,
      items_per_page: parsedLimit,
      has_next: parsedPage < totalPages,
      has_prev: parsedPage > 1
    };

    res.json({
      success: true,
      submissions,
      pagination,
      filters_applied: result.filters_applied
    });
  } catch (err) {
    console.error('Error fetching published submissions:', err);
    res.status(500).send(err.message);
  }
});



// Public API endpoint for individual paper details
app.get('/api/paper/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Paper ID is required'
      });
    }

    // Get submission details for published paper only
    const submissionDetails = await getSubmissionDetailsForAdmin(id, 'public@system');

    // Check if submission is published
    if (submissionDetails.status !== 'published') {
      return res.status(404).json({
        success: false,
        error: 'Paper not found or not published'
      });
    }

    // Format the response for public consumption
    const paperData = {
      id: submissionDetails.id,
      title: submissionDetails.title,
      abstract: submissionDetails.abstract,
      keywords: submissionDetails.keywords || [],
      paper_type: submissionDetails.paper_type,
      status: submissionDetails.status,
      published_at: submissionDetails.published_at,
      created_at: submissionDetails.created_at,
      doi: submissionDetails.doi,
      volume: submissionDetails.volume,
      issue: submissionDetails.issue,
      pages: submissionDetails.pages,
      author_name: submissionDetails.author_name,
      author_email: submissionDetails.author_email,
      affiliation: submissionDetails.affiliation,
      author_location: submissionDetails.author?.location || null,
      // Optionally expose full author object for future needs
      author: submissionDetails.author ? {
        full_name: submissionDetails.author.full_name,
        email: submissionDetails.author.email,
        affiliation: submissionDetails.author.affiliation,
        location: submissionDetails.author.location
      } : null,
      submission_files: submissionDetails.submission_files || [],
      download_count: submissionDetails.download_count || 0
    };

    res.json({
      success: true,
      paper: paperData
    });
  } catch (err) {
    console.error('Error fetching paper details:', err);
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Paper not found'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Auth0 config info
app.get('/api/auth-config', (_req, res) => {
  res.json({
    enabled: hasAuthConfig,
    baseURL: process.env.AUTH0_BASE_URL,
    domain: process.env.AUTH0_DOMAIN,
    hasSecret: !!process.env.AUTH0_SECRET,
    hasClientId: !!process.env.AUTH0_CLIENT_ID,
    hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET
  });
});

// Import Supabase storage service
import { uploadFile } from './src/services/supabase-storage.js';

// Database services
import { createSubmission } from './src/services/submission-service.js';

// API endpoints (protected)
app.post('/api/submissions', requireAuthApi, async (req, res) => {
  try {
    console.log('=== SUBMISSION ENDPOINT DEBUG ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('User from Auth0:', req.oidc?.user);
    
    // Get user from Auth0
    const auth0User = req.oidc.user;
    
    // Find user in database by email (primary identifier)
    const { data: user, error: userError } = await supabase
      .from('account_emails')
      .select('*')
      .eq('email_lower', auth0User.email.toLowerCase())
      .single();
      
    if (userError && userError.code !== 'PGRST116') {
      console.error('Error finding user:', userError);
      return res.status(500).send('Error finding user');
    }
    
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    console.log('Database user:', JSON.stringify(user, null, 2));
    
    // Log the exact data being passed to createSubmission
    const submissionPayload = {
      title: req.body.title,
      abstract: req.body.abstract,
      keywords: req.body.keywords,
      paper_type: req.body.paper_type,
      authors: req.body.authors,
      firstAuthorEmail: req.body.firstAuthorEmail,
      firstAuthorName: req.body.firstAuthorName,
      termsAccepted: req.body.termsAccepted
    };
    
    console.log('Submission payload:', JSON.stringify(submissionPayload, null, 2));
    
    // Create submission using the service
    const submission = await createSubmission(
      submissionPayload,
      user,
      null, // No file buffer as file is already uploaded
      null, // No original filename
      null, // No mimetype
      req.body.file_url // Use the file URL from the request body
    );
    
    console.log('Submission created successfully:', submission.id);
    console.log('=== END SUBMISSION DEBUG ===');
    
    res.json(submission);
  } catch (err) {
    console.error('Error creating submission:', err);
    res.status(500).send(err.message);
  }
});

// Get user's submissions
app.get('/api/submissions', requireAuthApi, async (req, res) => {
  try {
    // Get user from Auth0
    const auth0User = req.oidc.user;
    
    // Get submissions for this user using email (more reliable than UUID)
    const userEmail = auth0User.email;
    
    if (!userEmail) {
      return res.status(400).send('User email not found');
    }
    
    // Apply filters
    let query = supabase
      .from('submissions')
      .select('*')
      .eq('owner_email_lower', userEmail.toLowerCase());
    
    // Apply status filter if provided
    if (req.query.status) {
      query = query.eq('status', req.query.status);
    }

    // Order by creation date
    query = query.order('created_at', { ascending: false });
    
    // Execute the query
    const { data: submissions, error: submissionsError } = await query;
      
    if (submissionsError) {
      console.error('Error finding submissions:', submissionsError);
      return res.status(500).send('Error finding submissions');
    }
    res.json(submissions);
  }
  catch (err) {
    console.error('Error fetching submissions:', err);
  
    res.status(500).send(err.message);
  }
});


// Get submission by ID
app.get('/api/submissions/:id', requireAuthApi, async (req, res) => {
  try {
    // Get user from Auth0
    
    const submission = await getSubmissionById(req.params.id);
    
    // Check if user is authorized to view this submission
    const auth0User = req.oidc.user;
    
    // Get user account from Supabase by email
    const { getAccountByEmail } = await import('./src/services/account-service.js');
    const account = await getAccountByEmail(auth0User.email);
    
    if (!account) {
      return res.status(404).send('User not found');
    }
    
    // Only allow access if user is the author or has admin/reviewer role
    if (submission.userId !== account.id && account.role !== 'admin' && account.role !== 'reviewer') {
      return res.status(403).send('Not authorized to view this submission');
    }
    
    res.json(submission);
  } catch (err) {
    console.error('Error fetching submission:', err);
    res.status(500).send(err.message);
  }
});

// Check if reviewer application exists by email
app.get('/api/reviewer-applications/check/:email', requireAuthApi, async (req, res) => {
  try {
    const auth0User = req.oidc?.user;
    if (!auth0User?.email) {
      return res.status(401).send('User not authenticated');
    }
    
    const email = req.params.email;
    
    // Only allow checking their own email
    if (email !== auth0User.email) {
      return res.status(403).send('Can only check your own email');
    }
    
    const existingApplication = await getReviewerApplicationByEmail(email);
    
    res.json({
      exists: !!existingApplication,
      application: existingApplication,
      message: existingApplication ? 'You already have a reviewer application' : null
    });
  } catch (err) {
    console.error('Error checking reviewer application:', err);
    res.status(500).send(err.message);
  }
});

app.post('/api/reviewer-applications', requireAuthApi, (req, res, next) => {
  // Check if the request is a JSON payload with cvUrl
  if (req.headers['content-type'] === 'application/json') {
    return next();
  }
  // Otherwise, use multer for file upload
  upload.single('cv')(req, res, next);
}, async (req, res) => {
  try {
    const auth0User = req.oidc?.user;
    if (!auth0User?.email) {
      return res.status(401).send('User not authenticated');
    }

    const { sub, email, name } = auth0User;

    // Check if we have a file upload or a CV URL
    const hasCvFile = req.file && req.file.buffer;
    const hasCvUrl = req.body && req.body.cvUrl;
    
    if (!hasCvFile && !hasCvUrl) {
      return res.status(400).send('CV file or URL is required');
    }

    // Check if reviewer application already exists by email (primary verification)
    const existingApplication = await getReviewerApplicationByEmail(email);
    if (existingApplication) {
      // If application exists, redirect to reviewer dashboard
      return res.json({
        redirect: '/dashboard/reviewer',
        message: 'You already have a reviewer application',
        application: existingApplication
      });
    }

    // Get account by email (primary identifier)
    const account = await getAccountByEmail(email);
    if (!account) {
      return res.status(404).send('User account not found');
    }

    // Create reviewer application
    let reviewerProfile;
    
    if (req.file) {
      // Handle file upload via multer
      reviewerProfile = await createReviewerApplication(
        {
          fullName: req.body.fullName || name, // Use form fullName or fallback to Auth0 name
          degree: req.body.degree,
          experience: req.body.experience,
          institution: req.body.institution,
          expertise: req.body.expertise, // Pass expertise keywords as comma-separated string
        },
        { email, auth0Id: sub },
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    } else if (req.body.cvUrl) {
      // Handle CV URL from client
      reviewerProfile = await createReviewerApplication(
        {
          fullName: req.body.fullName || name, // Use form fullName or fallback to Auth0 name
          degree: req.body.department || req.body.degree, // Handle both field names
          experience: req.body.experience,
          institution: req.body.institution,
          expertise: req.body.expertise, // Pass expertise keywords as comma-separated string
        },
        { email, auth0Id: sub },
        null, // No buffer for URL-based submission
        null, // No filename for URL-based submission
        null, // No mimetype for URL-based submission
        req.body.cvUrl // Pass the CV URL
      );
    } else {
      return res.status(400).send('CV file is required');
    }

    res.json(reviewerProfile);
  } catch (err) {
    console.error('Error creating reviewer profile:', err);
    res.status(500).send(err.message);
  }
});

// Get reviewer profile for current user
app.get('/api/reviewer-profile', requireAuthApi, async (req, res) => {
  try {
    const auth0User = req.oidc?.user;
    if (!auth0User?.email) {
      return res.status(401).send('User not authenticated');
    }

    // Get reviewer profile by email (primary verification only)
    const reviewerProfile = await getReviewerApplicationByEmail(auth0User.email);
    
    if (!reviewerProfile) {
      return res.status(404).send('Reviewer profile not found');
    }

    res.json(reviewerProfile);
  } catch (err) {
    console.error('Error fetching reviewer profile:', err);
    res.status(500).send(err.message);
  }
});
// Get all reviewer profiles (admin only)
app.get('/api/reviewer-profiles', requireAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    // Apply filters if provided
    const filters = {};
    if (req.query.status) {
      filters.status = req.query.status;
    }
    
    // Pass the filters to the service function
    const reviewerProfiles = await getReviewerApplications(filters);
    res.json(reviewerProfiles);
  } catch (err) {
    console.error('Error fetching reviewer profiles:', err);
    res.status(500).send(err.message);
  }
});

// Get unassigned submissions (for reviewers)
app.get('/api/unassigned-submissions', requireAuthApi, async (req, res) => {
  try {
    // Get user from Auth0
    const auth0User = req.oidc.user;
    
    // Find user in database by email
    // getAccountByEmail is already imported at the top of the file
    const account = await getAccountByEmail(auth0User.email);
    
    if (!account) {
      return res.status(404).send('User not found');
    }
    
    // Check if user is reviewer using email
    const reviewerProfile = await getReviewerApplicationByEmail(auth0User.email);
    if (!reviewerProfile || reviewerProfile.status !== 'APPROVED') {
      return res.status(403).send('Not authorized');
    }
    
    // Get submissions that are under review or submitted but not assigned to this reviewer
    // First, get submission IDs that are already assigned to this reviewer
    const { data: assignedIds, error: assignedError } = await supabase
      .from('reviews')
      .select('submission_id')
      .eq('reviewer_id', reviewerProfile.id);
      
    if (assignedError) {
      console.error('Error fetching assigned submission IDs:', assignedError);
      return res.status(500).send(assignedError.message);
    }
    
    const excludeIds = assignedIds?.map(r => r.submission_id) || [];
    
    let query = supabase
      .from('submissions')
      .select(`
        *
      `)
      .in('status', ['under_review', 'submitted']);
      
    if (excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`);
    }
    
    const { data: submissions, error } = await query;
      
    if (error) {
      console.error('Error fetching unassigned submissions:', error);
      return res.status(500).send(error.message);
    }
    
    res.json(submissions);
  } catch (err) {
    console.error('Error fetching unassigned submissions:', err);
    res.status(500).send(err.message);
  }
});

// Get assigned submissions (for reviewers)
app.get('/api/assigned-submissions', requireAuthApi, async (req, res) => {
  try {
    // Get user from Auth0
    const auth0User = req.oidc.user;
    
    // Find user in database by email (primary identifier)
    const account = await getAccountByEmail(auth0User.email);
    
    if (!account) {
      return res.status(404).send('User not found');
    }
    
    // Check if user is reviewer using email
    const reviewerProfile = await getReviewerApplicationByEmail(auth0User.email);
    if (!reviewerProfile || reviewerProfile.status !== 'APPROVED') {
      return res.status(403).send('Not authorized');
    }
    
    // Get submissions assigned to this reviewer
    const { data: submissions, error } = await supabase
      .from('submissions')
      .select(`
        *,
        reviews!inner(*),
        submission_files!inner(
          id,
          storage_key,
          original_filename,
          mime_type
        )
      `)
      .eq('reviews.reviewer_id', reviewerProfile.id);
      
    if (error) {
      console.error('Error fetching assigned submissions:', error);
      return res.status(500).send(error.message);
    }
    
    res.json(submissions);
  } catch (err) {
    console.error('Error fetching assigned submissions:', err);
    res.status(500).send(err.message);
  }
});

// Reviewer file serving endpoint - allows reviewers to view papers they're assigned to review
app.get('/api/reviewer/files/view/:fileId', requireAuthApi, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId) {
      return res.status(400).json({
        success: false,
        error: 'File ID is required'
      });
    }

    // Get user from Auth0
    const auth0User = req.oidc.user;
    
    // Check if user is reviewer using email
    const reviewerProfile = await getReviewerApplicationByEmail(auth0User.email);
    if (!reviewerProfile || reviewerProfile.status !== 'APPROVED') {
      return res.status(403).send('Not authorized as reviewer');
    }

    // Get file info and verify reviewer has access to this submission
    const { data: fileInfo, error: fileError } = await supabase
      .from('submission_files')
      .select(`
        storage_key,
        original_filename,
        submission_id,
        submissions!inner(
          id,
          reviews!inner(reviewer_id)
        )
      `)
      .eq('id', fileId)
      .eq('submissions.reviews.reviewer_id', reviewerProfile.id)
      .single();
    
    if (fileError || !fileInfo) {
      console.error('Error finding file info or access denied:', fileError);
      return res.status(404).json({
        success: false,
        error: 'File not found or access denied'
      });
    }

    // Redirect to the storage URL to view the file
    if (fileInfo.storage_key) {
      res.redirect(fileInfo.storage_key);
    } else {
      return res.status(404).json({
        success: false,
        error: 'File URL not available'
      });
    }

  } catch (err) {
    console.error('Error in reviewer file view endpoint:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Admin file download endpoint - allows admins to download published submission files
app.get('/api/submissions/:id/download', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required'
      });
    }

    // Get file info and verify submission is published
    const { data: fileInfo, error: fileError } = await supabase
      .from('submission_files')
      .select(`
        storage_key,
        original_filename,
        submission_id,
        submissions!inner(status)
      `)
      .eq('id', id)
      .eq('submissions.status', 'published')
      .single();
    
    if (fileError || !fileInfo) {
      console.error('Error finding file info or submission not published:', fileError);
      return res.status(404).json({
        success: false,
        error: 'File not found or submission is not published'
      });
    }

    // Redirect to the storage URL to download the file
    if (fileInfo.storage_key) {
      res.redirect(fileInfo.storage_key);
    } else {
      return res.status(404).json({
        success: false,
        error: 'File URL not available'
      });
    }

  } catch (err) {
    console.error('Error in admin file download endpoint:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.post('/api/upload', requireAuthApi, upload.single('file'), async (req, res) => {
  try {
    // Get user from Auth0
    const auth0User = req.oidc.user;
    
    // Determine file type based on request (default to 'paper')
    const fileType = req.query.type || req.body.type || 'paper';
    
    // Upload file to Supabase Storage with file type
    const result = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      fileType
    );
    
    res.json(result);
  } catch (err) {
    console.error('Error uploading file:', err);
    res.status(500).send(err.message);
  }
});

// will be redirected to the new endpoints
app.all('/api/worker/submissions', (req, res) => {
  res.redirect(307, '/api/submissions');
});

app.all('/api/worker/reviewer-applications', (req, res) => {
  res.redirect(307, '/api/reviewer-applications');
});

app.all('/api/worker/upload', (req, res) => {
  res.redirect(307, '/api/upload');
});

// Claim a submission for review
app.post('/api/claim-submission/:id', requireAuthApi, async (req, res) => {
  try {
    // Get user from Auth0
    const auth0User = req.oidc.user;
    
    // Find user in database by email (primary identifier)
    const account = await getAccountByEmail(auth0User.email);
    
    if (!account) {
      return res.status(404).send('User not found');
    }
    
    // Check if user is reviewer using email
    const reviewerProfile = await getReviewerApplicationByEmail(auth0User.email);
    if (!reviewerProfile || reviewerProfile.status !== 'APPROVED') {
      return res.status(403).send('Not authorized');
    }
    
    // Get submission
    const submissionId = req.params.id;
    const submission = await getSubmissionById(submissionId);
    
    if (!submission) {
      return res.status(404).send('Submission not found');
    }
    
    // Check if submission is available for review
    if (submission.status !== 'UNDER_REVIEW') {
      return res.status(400).send('Submission is not available for review');
    }
    
    // Check if reviewer already has this submission
    const { data: existingReview, error: findError } = await supabase
      .from('reviews')
      .select('*')
      .eq('submission_id', submissionId)
      .eq('reviewer_id', reviewerProfile.id)
      .maybeSingle();
      
    if (findError) {
      console.error('Error checking existing review:', findError);
      return res.status(500).send(findError.message);
    }
    
    if (existingReview) {
      return res.status(400).send('You have already claimed this submission');
    }
    
    // Create review
    const dueDate = new Date(Date.now() + 14 * 86400000); // 14 days from now
    const { data: review, error: createError } = await supabase
      .from('reviews')
      .insert({
        submission_id: submissionId,
        reviewer_id: reviewerProfile.id,
        status: 'PENDING',
        due_date: dueDate.toISOString()
      })
      .select()
      .single();
      
    if (createError) {
      console.error('Error creating review:', createError);
      return res.status(500).send(createError.message);
    }
    
    res.json(review);
  } catch (err) {
    console.error('Error claiming submission:', err);
    res.status(500).send(err.message);
  }
});

// ==================== ADMIN SUBMISSION MANAGEMENT ENDPOINTS ====================

// Get all submissions for admin dashboard
app.get('/api/admin/submissions', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const {
      search,
      status,
      paper_type,
      author_email,
      reviewer_id,
      is_verified,
      has_reviewers,
      date_range,
      sort_by,
      page = 1,
      limit = 20
    } = req.query;

    const parsedLimit = Number.parseInt(limit, 10) || 20;
    const parsedPage = Number.parseInt(page, 10) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    const filters = {
      search: search?.trim() || undefined,
      status: status || undefined,
      paper_type: paper_type || undefined,
      author_email: author_email || undefined,
      reviewer_id: reviewer_id || undefined,
      sort_by: sort_by || undefined
    };

    if (typeof is_verified !== 'undefined') {
      filters.is_verified = is_verified === 'true';
    }

    if (typeof has_reviewers !== 'undefined') {
      filters.has_reviewers = has_reviewers === 'true';
    }

    if (date_range) {
      const now = new Date();
      let rangeStart = null;

      switch (date_range) {
        case 'today':
          rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          rangeStart = new Date(now.getTime() - 7 * 86400000);
          break;
        case 'month':
          rangeStart = new Date(now.getTime() - 30 * 86400000);
          break;
        case 'quarter':
          rangeStart = new Date(now.getTime() - 90 * 86400000);
          break;
        default:
          break;
      }

      if (rangeStart) {
        filters.created_after = rangeStart.toISOString();
      }
    }

    // Clean undefined filters
    Object.keys(filters).forEach((key) => {
      if (filters[key] === undefined || filters[key] === null || filters[key] === '') {
        delete filters[key];
      }
    });

    const adminEmail = getAdminEmail(req);
    const result = await getSubmissionsForAdmin(
      filters,
      parsedLimit,
      offset,
      adminEmail
    );

    const totalItems = result.pagination.total || 0;
    const totalPages = parsedLimit > 0 ? Math.max(1, Math.ceil(totalItems / parsedLimit)) : 1;

    const pagination = {
      total_items: totalItems,
      total_pages: totalPages,
      current_page: parsedPage,
      per_page: parsedLimit,
      items_on_page: result.data.length,
      has_more: result.pagination.has_more
    };

    res.json({
      success: true,
      submissions: result.data,
      pagination,
      filters_applied: result.filters_applied
    });
  } catch (err) {
    console.error('Error fetching admin submissions:', err);
    res.status(500).send(err.message);
  }
});

// Get published submissions for admin dashboard
app.get('/api/admin/published', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const {
      search,
      paper_type,
      author_email,
      date_range,
      sort_by,
      page = 1,
      limit = 20
    } = req.query;

    const parsedLimit = Number.parseInt(limit, 10) || 20;
    const parsedPage = Number.parseInt(page, 10) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    const filters = {
      search: search?.trim() || undefined,
      status: 'published', // Only published submissions
      paper_type: paper_type || undefined,
      author_email: author_email?.trim() || undefined,
      date_range: date_range || undefined,
      sort_by: sort_by || 'published_at_desc'
    };

    const adminEmail = getAdminEmail(req);
    const result = await getSubmissionsForAdmin(
      filters, 
      parsedLimit, 
      offset,
      adminEmail
    );

    const { data: submissions, pagination: resultPagination } = result;
    const total = resultPagination.total;
    const totalPages = Math.ceil(total / parsedLimit);

    const pagination = {
      current_page: parsedPage,
      total_pages: totalPages,
      total_items: total,
      items_per_page: parsedLimit,
      has_next: parsedPage < totalPages,
      has_prev: parsedPage > 1
    };

    res.json({
      success: true,
      submissions,
      pagination,
      filters_applied: result.filters_applied
    });
  } catch (err) {
    console.error('Error fetching published submissions:', err);
    res.status(500).send(err.message);
  }
});

// Update submission status (admin only)
app.put('/api/admin/submissions/:id/status', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { id } = req.params;
    const { status, comments } = req.body;
    
    // Validate status
    const validStatuses = ['submitted', 'under_review', 'minor_revision', 'major_revision', 'accepted', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).send('Invalid status');
    }
    
    // Update submission status
    const { data: updatedSubmission, error } = await supabase
      .from('submissions')
      .update({ 
        status: status,
        decision_comments: comments || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating submission status:', error);
      return res.status(500).send(error.message);
    }
    
    res.json({
      success: true,
      submission: updatedSubmission,
      message: `Submission status updated to ${status}`
    });
  } catch (err) {
    console.error('Error updating submission status:', err);
    res.status(500).send(err.message);
  }
});

// Get available reviewers for assignment
app.get('/api/admin/reviewers', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    // Get all reviewers (including pending for testing - in production, filter by approved only)
    const { data: reviewers, error } = await supabase
      .from('reviewer_applications')
      .select('id, full_name, applicant_email, institution, status, degree, experience')
      .order('full_name', { ascending: true });
    
    if (error) {
      console.error('Error fetching reviewers:', error);
      return res.status(500).send(error.message);
    }
    
    // Format the response
    const formattedReviewers = reviewers.map(reviewer => ({
      id: reviewer.id,
      name: reviewer.full_name,
      email: reviewer.applicant_email,
      expertise: reviewer.degree || 'Not specified', // Use degree as expertise since expertise_areas doesn't exist
      institution: reviewer.institution,
      status: 'active',
      experience: reviewer.experience
    }));
    
    res.json(formattedReviewers);
  } catch (err) {
    console.error('Error fetching reviewers:', err);
    res.status(500).send(err.message);
  }
});

// Assign/update reviewers for a submission
app.put('/api/admin/submissions/:id/reviewers', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewers } = req.body;
    
    if (!id) {
      return res.status(400).send('Submission ID is required');
    }

    if (!Array.isArray(reviewers)) {
      return res.status(400).send('Reviewers must be an array');
    }
    
    // Start a transaction to update reviewer assignments
    // First, remove existing review assignments for this submission
    const { error: deleteError } = await supabase
      .from('reviews')
      .delete()
      .eq('submission_id', id);
    
    if (deleteError) {
      console.error('Error removing existing reviews:', deleteError);
      return res.status(500).send(deleteError.message);
    }
    
    // Create new review assignments
    if (reviewers.length > 0) {
      const reviewAssignments = reviewers.map(reviewerId => ({
        submission_id: id,
        reviewer_id: reviewerId,
        status: 'PENDING',
        assigned_at: new Date().toISOString(),
        due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() // 2 weeks from now
      }));
      
      const { error: insertError } = await supabase
        .from('reviews')
        .insert(reviewAssignments);
      
      if (insertError) {
        console.error('Error creating review assignments:', insertError);
        return res.status(500).send(insertError.message);
      }
    }
    
    // Update submission status to under_review if reviewers are assigned
    if (reviewers.length > 0) {
      const { error: updateError } = await supabase
        .from('submissions')
        .update({ 
          status: 'under_review',
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
      
      if (updateError) {
        console.error('Error updating submission status:', updateError);
        // Don't fail the request for this
      }
    }
    
    res.json({
      success: true,
      message: `${reviewers.length} reviewer(s) assigned to submission`,
      reviewers: reviewers
    });
  } catch (err) {
    console.error('Error updating reviewer assignments:', err);
    res.status(500).send(err.message);
  }
});

// Get admin dashboard analytics
app.get('/api/admin/analytics', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware
    
    // Get submission statistics
    const { data: submissions, error: submissionError } = await supabase
      .from('submissions')
      .select('status, created_at');
    
    const { data: authors, error: authorError } = await supabase
      .from('authors')
      .select('created_at');
    
    const { data: reviewers, error: reviewerError } = await supabase
      .from('reviewer_applications')
      .select('status, created_at');
    
    if (submissionError || authorError || reviewerError) {
      console.error('Error fetching analytics data:', submissionError, authorError, reviewerError);
      return res.status(500).send('Error fetching analytics data');
    }
    
    // Calculate statistics
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const normalizeReviewerStatus = status => (status || '').toUpperCase();

    const analytics = {
      submissions: {
        total: submissions.length,
        byStatus: submissions.reduce((acc, sub) => {
          acc[sub.status] = (acc[sub.status] || 0) + 1;
          return acc;
        }, {}),
        recent: submissions.filter(sub => new Date(sub.created_at) > thirtyDaysAgo).length
      },
      authors: {
        total: authors.length,
        recent: authors.filter(author => new Date(author.created_at) > thirtyDaysAgo).length
      },
      reviewers: {
        total: reviewers.length,
        approved: reviewers.filter(r => normalizeReviewerStatus(r.status) === 'APPROVED').length,
        pending: reviewers.filter(r => normalizeReviewerStatus(r.status) === 'PENDING').length,
        recent: reviewers.filter(reviewer => new Date(reviewer.created_at) > thirtyDaysAgo).length
      }
    };
    
    res.json(analytics);
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).send(err.message);
  }
});

// Get all users for comprehensive user management
app.get('/api/admin/users', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    const normalizeReviewerStatus = status => (status || '').toUpperCase();
    
    // Get all account emails with metadata
    const { data: accountEmails, error: accountError } = await supabase
      .from('account_emails')
      .select('*')
      .order('created_at', { ascending: false });
    
    // Get all authors
    const { data: authors, error: authorError } = await supabase
      .from('authors')
      .select('*')
      .order('created_at', { ascending: false });
    
    // Get all reviewer applications
    const { data: reviewerApps, error: reviewerError } = await supabase
      .from('reviewer_applications')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (accountError || authorError || reviewerError) {
      console.error('Error fetching users data:', accountError, authorError, reviewerError);
      return res.status(500).send('Error fetching users data');
    }
    
    // Combine data into comprehensive user list
    const users = [];
    const processedEmails = new Set();
    
    // Process authors
    authors.forEach(author => {
      if (!processedEmails.has(author.email_lower)) {
        const accountData = accountEmails.find(acc => acc.email_lower === author.email_lower);
        const reviewerApp = reviewerApps.find(rev => rev.applicant_email_lower === author.email_lower);
        
        const normalizedReviewerStatus = reviewerApp ? normalizeReviewerStatus(reviewerApp.status) : null;

        users.push({
          id: author.author_uid,
          email: author.email,
          name: author.full_name || 'Not provided',
          primary_role: 'author',
          roles: ['author', ...(reviewerApp ? ['reviewer'] : [])],
          status: 'active', // Authors are automatically active when created
          affiliation: author.affiliation,
          location: author.location,
          research_interests: author.research_interests,
          created_at: author.created_at,
          auth_user_id: accountData?.auth_user_id,
          reviewer_status: normalizedReviewerStatus,
        });
        processedEmails.add(author.email_lower);
      }
    });
    
    // Process reviewer applications that don't have author profiles
    reviewerApps.forEach(reviewer => {
      if (!processedEmails.has(reviewer.applicant_email_lower)) {
        const accountData = accountEmails.find(acc => acc.email_lower === reviewer.applicant_email_lower);
        
        const normalizedReviewerStatus = normalizeReviewerStatus(reviewer.status);

        users.push({
          id: reviewer.id,
          email: reviewer.applicant_email,
          name: reviewer.full_name || 'Not provided',
          primary_role: 'reviewer',
          roles: ['reviewer'],
          status: normalizedReviewerStatus === 'APPROVED' ? 'active' : 'pending',
          affiliation: reviewer.institution,
          location: null,
          degree: reviewer.degree,
          experience: reviewer.experience,
          created_at: reviewer.created_at,
          auth_user_id: accountData?.auth_user_id,
          reviewer_status: normalizedReviewerStatus,
          reviewer_expertise: reviewer.degree
        });
        processedEmails.add(reviewer.applicant_email_lower);
      }
    });
    
    // Process any remaining account emails (users who signed up but didn't complete profiles)
    accountEmails.forEach(account => {
      if (!processedEmails.has(account.email_lower)) {
        users.push({
          id: account.account_uid,
          email: account.email,
          name: 'Profile incomplete',
          primary_role: 'unknown',
          roles: [],
          status: 'inactive',
          affiliation: null,
          location: null,
          created_at: account.created_at,
          auth_user_id: account.auth_user_id,
          reviewer_status: null,
          reviewer_expertise: null
        });
        processedEmails.add(account.email_lower);
      }
    });
    
    res.json(users);
  } catch (err) {
    console.error('Error fetching all users:', err);
    res.status(500).send(err.message);
  }
});

// Update user status (enable/disable user)
app.put('/api/admin/users/:userId/status', requireAdminAuthApi, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body;
    const adminEmail = getAdminEmail(req);
    const timestamp = new Date().toISOString();

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).send('Invalid status');
    }

    // Update author metadata if author exists
    const { data: authorRecord, error: authorFetchError } = await supabase
      .from('authors')
      .select('metadata')
      .eq('author_uid', userId)
      .maybeSingle();

    if (authorFetchError) {
      console.error('Error fetching author for status update:', authorFetchError);
      return res.status(500).send('Error updating author status');
    }

    if (authorRecord) {
      const authorMetadata = {
        ...(authorRecord.metadata || {}),
        admin_status: status,
        status_reason: reason || null,
        status_updated_at: timestamp,
        status_updated_by: adminEmail
      };

      const { error: authorUpdateError } = await supabase
        .from('authors')
        .update({ metadata: authorMetadata })
        .eq('author_uid', userId);

      if (authorUpdateError) {
        console.error('Error updating author metadata:', authorUpdateError);
        return res.status(500).send('Error updating author status');
      }
    }

    // Optionally update reviewer status when suspending access
    if (status === 'suspended') {
      const { data: reviewerRecord, error: reviewerFetchError } = await supabase
        .from('reviewer_applications')
        .select('status')
        .eq('id', userId)
        .maybeSingle();

      if (reviewerFetchError) {
        console.error('Error fetching reviewer for suspension:', reviewerFetchError);
        return res.status(500).send('Error updating reviewer status');
      }

      if (reviewerRecord) {
        const { error: reviewerUpdateError } = await supabase
          .from('reviewer_applications')
          .update({ status: 'SUSPENDED', updated_at: timestamp })
          .eq('id', userId);

        if (reviewerUpdateError) {
          console.error('Error suspending reviewer:', reviewerUpdateError);
          return res.status(500).send('Error updating reviewer status');
        }
      }
    }

    res.json({
      success: true,
      message: `User status updated to ${status}`,
      updated_by: adminEmail,
      updated_at: timestamp
    });
  } catch (err) {
    console.error('Error updating user status:', err);
    res.status(500).send(err.message);
  }
});

// Update user role
app.put('/api/admin/users/:userId/role', requireAdminAuthApi, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, action } = req.body; // action: 'add' or 'remove'
    const adminEmail = getAdminEmail(req);
    const timestamp = new Date().toISOString();

    if (!['author', 'reviewer', 'admin'].includes(role)) {
      return res.status(400).send('Invalid role');
    }

    if (!['add', 'remove'].includes(action)) {
      return res.status(400).send('Invalid action');
    }

    if (role === 'reviewer') {
      if (action === 'add') {
        const { data: existingApp, error: reviewerLookupError } = await supabase
          .from('reviewer_applications')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (reviewerLookupError) {
          console.error('Error fetching reviewer application:', reviewerLookupError);
          return res.status(500).send('Error updating reviewer role');
        }

        if (existingApp) {
          const { error } = await supabase
            .from('reviewer_applications')
            .update({
              status: 'APPROVED',
              updated_at: timestamp,
              approved_by: adminEmail,
              approved_at: timestamp
            })
            .eq('id', userId);

          if (error) {
            console.error('Error updating reviewer application:', error);
            return res.status(500).send('Error updating reviewer role');
          }
        } else {
          return res.status(400).send('No reviewer application found for this user');
        }
      } else {
        const { error } = await supabase
          .from('reviewer_applications')
          .update({
            status: 'REJECTED',
            updated_at: timestamp,
            rejected_by: adminEmail,
            rejected_at: timestamp
          })
          .eq('id', userId);

        if (error) {
          console.error('Error removing reviewer role:', error);
          return res.status(500).send('Error removing reviewer role');
        }
      }
    } else if (role === 'admin') {
      console.log(`Admin role ${action} requested for user ${userId} by ${adminEmail}`);
      return res.status(501).send('Admin role management not implemented for security reasons');
    }

    res.json({
      success: true,
      message: `User role ${role} ${action}ed successfully`,
      updated_by: adminEmail,
      updated_at: timestamp
    });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).send(err.message);
  }
});

// Get user details for detailed view
app.get('/api/admin/users/:userId', requireAdminAuthApi, async (req, res) => {
  try {
    const { userId } = req.params;
    // Admin authentication handled by requireAdminAuthApi middleware

    const normalizeReviewerStatus = status => (status || '').toUpperCase();

    
    // Get user details from all tables
    const [authorResult, reviewerResult, accountResult] = await Promise.all([
      supabase.from('authors').select('*').eq('author_uid', userId).single(),
      supabase.from('reviewer_applications').select('*').eq('id', userId).single(),
      supabase.from('account_emails').select('*').eq('account_uid', userId).single()
    ]);
    
    // Also try to find by email if not found by ID
    let userDetails = null;
    
    if (authorResult.data) {
      userDetails = {
        type: 'author',
        ...authorResult.data,
        account: accountResult.data
      };
    } else if (reviewerResult.data) {
      userDetails = {
        type: 'reviewer',
        ...reviewerResult.data,
        account: accountResult.data
      };
    } else if (accountResult.data) {
      userDetails = {
        type: 'account_only',
        ...accountResult.data
      };
    }
    
    if (!userDetails) {
      return res.status(404).send('User not found');
    }
    
    // Get user's submissions if they're an author
    if (userDetails.type === 'author') {
      const { data: submissions } = await supabase
        .from('submissions')
        .select('id, title, status, created_at, paper_type')
        .eq('owner_email_lower', userDetails.email_lower);
      
      userDetails.submissions = submissions || [];
    }
    
    // Get user's reviews if they're a reviewer
    if (userDetails.type === 'reviewer' && normalizeReviewerStatus(userDetails.status) === 'APPROVED') {
      // Note: This would require the reviews table to be created
      userDetails.review_assignments = [];
    }
    
    res.json(userDetails);
  } catch (err) {
    console.error('Error fetching user details:', err);
    res.status(500).send(err.message);
  }
});

// ==================== ENHANCED ADMIN AUTHOR MANAGEMENT ENDPOINTS ====================

// Import admin author service
import { 
  getAuthorsForAdmin, 
  getAuthorProfileForAdmin, 
  getAuthorSuggestions, 
  getAuthorsBySubmissionStatus,
  updateAuthorForAdmin,
  getAuthorStatistics,
  syncAuthorSubmissionCounts
} from './src/services/admin-author-service.js';

// Get all authors with advanced filtering and search
app.get('/api/admin/authors', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const {
      search,
      affiliation,
      location,
      hasSubmissions,
      submissionStatus,
      createdAfter,
      createdBefore,
      page = 1,
      limit = 20
    } = req.query;

    const parsedLimit = Number.parseInt(limit, 10) || 20;
    const parsedPage = Number.parseInt(page, 10) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    const filters = {
      search: search?.trim() || undefined,
      affiliation: affiliation || undefined,
      location: location || undefined,
      hasSubmissions: typeof hasSubmissions !== 'undefined' ? hasSubmissions === 'true' : undefined,
      submissionStatus: submissionStatus || undefined,
      createdAfter: createdAfter || undefined,
      createdBefore: createdBefore || undefined
    };

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined || filters[key] === null || filters[key] === '') {
        delete filters[key];
      }
    });

    const result = await getAuthorsForAdmin(
      filters,
      parsedLimit,
      offset
    );

    const totalItems = result.pagination.total || 0;
    const totalPages = parsedLimit > 0 ? Math.max(1, Math.ceil(totalItems / parsedLimit)) : 1;

    const pagination = {
      total_items: totalItems,
      total_pages: totalPages,
      current_page: parsedPage,
      per_page: parsedLimit,
      items_on_page: result.data.length,
      has_more: result.pagination.has_more
    };

    res.json({
      success: true,
      authors: result.data,
      pagination,
      filters_applied: result.filters_applied
    });
  } catch (err) {
    console.error('Error fetching authors for admin:', err);
    res.status(500).send(err.message);
  }
});

// Get aggregated author statistics before dynamic author routes
app.get('/api/admin/authors/statistics', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const stats = await getAuthorStatistics();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error in authors statistics endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get detailed author profile with submissions and statistics
app.get('/api/admin/authors/:email', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).send('Email parameter is required');
    }
    const adminEmail = getAdminEmail(req);
    const authorProfile = await getAuthorProfileForAdmin(email, adminEmail);
    
    res.json(authorProfile);
  } catch (err) {
    console.error('Error fetching author profile for admin:', err);
    if (err.message.includes('not found')) {
      res.status(404).send(err.message);
    } else {
      res.status(500).send(err.message);
    }
  }
});

// Get author suggestions for search/autocomplete
app.get('/api/admin/authors/search/suggestions', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { q, limit = 10 } = req.query;
    
    if (!q) {
      return res.json([]);
    }
    
    const suggestions = await getAuthorSuggestions(q, parseInt(limit));
    
    res.json(suggestions);
  } catch (err) {
    console.error('Error fetching author suggestions:', err);
    res.status(500).send(err.message);
  }
});

// Get authors by submission status
app.get('/api/admin/authors/by-status/:status', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { status } = req.params;
    const validStatuses = ['submitted', 'under_review', 'minor_revision', 'major_revision', 'accepted', 'rejected', 'verified', 'published'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).send('Invalid status parameter');
    }
    
    const authors = await getAuthorsBySubmissionStatus(status);
    
    res.json(authors);
  } catch (err) {
    console.error('Error fetching authors by submission status:', err);
    res.status(500).send(err.message);
  }
});

// Update author information (admin only)
app.put('/api/admin/authors/:email', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { email } = req.params;
    const updates = req.body;
    
    if (!email) {
      return res.status(400).send('Email parameter is required');
    }
    
    // Validate updates - only allow certain fields to be updated
    const allowedFields = ['full_name', 'affiliation', 'location', 'research_interests'];
    const filteredUpdates = {};
    
    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });
    
    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).send('No valid fields to update');
    }
    const adminEmail = getAdminEmail(req);
    const updatedAuthor = await updateAuthorForAdmin(email, filteredUpdates, adminEmail);
    
    res.json(updatedAuthor);
  } catch (err) {
    console.error('Error updating author for admin:', err);
    if (err.message.includes('not found')) {
      res.status(404).send(err.message);
    } else {
      res.status(500).send(err.message);
    }
  }
});

// Sync author submission counts
app.post('/api/admin/authors/sync-counts', requireAdminAuthApi, async (req, res) => {
  try {
    const adminEmail = getAdminEmail(req);
    console.log(`Starting submission count sync requested by admin: ${adminEmail}`);
    
    const result = await syncAuthorSubmissionCounts();
    
    console.log(`Sync completed: ${result.updated} updated, ${result.errors} errors`);
    
    res.json({
      success: true,
      message: 'Submission counts synced successfully',
      data: result
    });
  } catch (err) {
    console.error('Error syncing author submission counts:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to sync submission counts',
      details: err.message
    });
  }
});

// ==================== ENHANCED ADMIN SUBMISSION MANAGEMENT ENDPOINTS ====================

// Import enhanced admin submission service
import { 
  getSubmissionDetailsForAdmin,
  verifySubmissionForAdmin,
  assignReviewerToSubmission,
  publishSubmissionForAdmin,
  requestRevisionForSubmission,
  rejectSubmissionForAdmin,
  getSubmissionsForAdmin,
  getSubmissionStatistics,
  markReviewCompletedForAdmin
} from './src/services/admin-submission-service.js';

// Submission statistics endpoint
app.get('/api/admin/submissions/statistics', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const stats = await getSubmissionStatistics();
    
    // Transform statistics to match frontend expectations
    const transformedStats = {
      pending_submissions: stats.by_status?.pending || stats.by_status?.submitted || 0,
      under_review_submissions: stats.by_status?.under_review || 0,
      ready_to_publish: stats.by_status?.ready_to_publish || stats.by_status?.accepted || 0,
      overdue_submissions: 0, // Would need additional logic to calculate overdue
      total_submissions: stats.total_submissions || 0,
      verified_submissions: stats.verified_count || 0,
      published_submissions: stats.published_count || 0
    };
    
    res.json({
      success: true,
      data: transformedStats
    });
  } catch (err) {
    console.error('Error fetching submission statistics:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Enhanced submission details endpoint
app.get('/api/admin/submissions/:id/details', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { id } = req.params;

    if (!id) {
      return res.status(400).send('Valid submission ID is required');
    }

  const adminEmail = getAdminEmail(req);
  const submissionDetails = await getSubmissionDetailsForAdmin(id, adminEmail);
    
    res.json(submissionDetails);
  } catch (err) {
    console.error('Error fetching submission details for admin:', err);
    if (err.message.includes('not found')) {
      res.status(404).send(err.message);
    } else {
      res.status(500).send(err.message);
    }
  }
});

// Verify submission endpoint
app.post('/api/admin/submissions/:id/verify', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { id } = req.params;
    const verificationData = req.body;

    if (!id) {
      return res.status(400).send('Valid submission ID is required');
    }

    const adminEmail = getAdminEmail(req);
    const verifiedSubmission = await verifySubmissionForAdmin(
      id,
      adminEmail,
      verificationData
    );
    
    res.json({
      success: true,
      message: 'Submission verified successfully',
      submission: verifiedSubmission
    });
  } catch (err) {
    console.error('Error verifying submission:', err);
    res.status(500).send(err.message);
  }
});

// Assign reviewer endpoint
app.post('/api/admin/submissions/:id/assign-reviewer', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewer_id, due_date, notes } = req.body;

    if (!id) {
      return res.status(400).send('Valid submission ID is required');
    }
    
    if (!reviewer_id) {
      return res.status(400).send('Reviewer ID is required');
    }

    if (typeof reviewer_id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid reviewer ID format',
        code: 'INVALID_REVIEWER_ID_TYPE'
      });
    }

    const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidPattern.test(reviewer_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid reviewer ID format',
        code: 'INVALID_REVIEWER_ID_FORMAT'
      });
    }
    
    const assignmentData = {
      due_date,
      notes
    };
    
    const adminEmail = getAdminEmail(req);
    const review = await assignReviewerToSubmission(
      id,
      reviewer_id,
      adminEmail,
      assignmentData
    );
    
    res.json({
      success: true,
      message: 'Reviewer assigned successfully',
      review
    });
  } catch (err) {
    console.error('Error assigning reviewer:', err);
    
    // Handle specific error cases
    if (err.message.includes('already assigned')) {
      return res.status(409).json({
        success: false,
        error: err.message,
        code: 'REVIEWER_ALREADY_ASSIGNED'
      });
    }
    
    if (err.message.includes('must be approved')) {
      return res.status(400).json({
        success: false,
        error: err.message,
        code: 'REVIEWER_NOT_APPROVED'
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
      code: 'ASSIGNMENT_ERROR'
    });
  }
});

// Assign multiple reviewers to one submission
app.post('/api/admin/submissions/:id/assign-multiple-reviewers', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewer_ids, due_date, notes } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Valid submission ID is required'
      });
    }
    
    if (!Array.isArray(reviewer_ids) || reviewer_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'reviewer_ids must be a non-empty array'
      });
    }

    // Validate all reviewer IDs format
    const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    for (const reviewer_id of reviewer_ids) {
      if (typeof reviewer_id !== 'string' || !uuidPattern.test(reviewer_id)) {
        return res.status(400).json({
          success: false,
          error: `Invalid reviewer ID format: ${reviewer_id}`,
          code: 'INVALID_REVIEWER_ID_FORMAT'
        });
      }
    }

    // Check for duplicates in the request
    const uniqueReviewerIds = [...new Set(reviewer_ids)];
    if (uniqueReviewerIds.length !== reviewer_ids.length) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate reviewer IDs found in the request'
      });
    }
    
    const assignmentData = {
      due_date,
      notes
    };
    
    const adminEmail = getAdminEmail(req);
    const results = [];
    const errors = [];
    
    // Process each reviewer assignment
    for (const reviewer_id of uniqueReviewerIds) {
      try {
        const review = await assignReviewerToSubmission(
          id,
          reviewer_id,
          adminEmail,
          assignmentData
        );
        results.push({ 
          reviewer_id, 
          success: true, 
          review,
          reviewer_name: review.reviewer?.full_name || 'Unknown'
        });
      } catch (err) {
        console.error(`Error assigning reviewer ${reviewer_id} to submission ${id}:`, err);
        errors.push({ 
          reviewer_id, 
          success: false, 
          error: err.message 
        });
      }
    }
    
    res.json({
      success: true,
      message: `Processed ${uniqueReviewerIds.length} reviewer assignments`,
      results: {
        successful: results,
        failed: errors,
        total_processed: uniqueReviewerIds.length,
        successful_count: results.length,
        failed_count: errors.length
      }
    });
  } catch (err) {
    console.error('Error in multiple reviewer assignment:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Publish submission endpoint
app.post('/api/admin/submissions/:id/publish', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { id } = req.params;
    const publishData = req.body;

    if (!id) {
      return res.status(400).send('Valid submission ID is required');
    }

    const adminEmail = getAdminEmail(req);
    const publishedSubmission = await publishSubmissionForAdmin(
      id,
      adminEmail,
      publishData
    );
    
    res.json({
      success: true,
      message: 'Submission published successfully',
      submission: publishedSubmission
    });
  } catch (err) {
    console.error('Error publishing submission:', err);
    res.status(500).send(err.message);
  }
});

// Mark review completed endpoint (admin override)
app.post('/api/admin/submissions/:id/mark-review-completed', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;
    const overrideData = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Valid submission ID is required'
      });
    }

    const adminEmail = getAdminEmail(req);
    const updatedSubmission = await markReviewCompletedForAdmin(
      id,
      adminEmail,
      overrideData
    );
    
    res.json({
      success: true,
      message: 'Submission marked as review completed successfully',
      submission: updatedSubmission
    });
  } catch (err) {
    console.error('Error marking review completed:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Request revision endpoint
app.post('/api/admin/submissions/:id/request-revision', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { id } = req.params;
    const revisionData = req.body;

    if (!id) {
      return res.status(400).send('Valid submission ID is required');
    }
    
    if (!revisionData.comments) {
      return res.status(400).send('Revision comments are required');
    }

    const adminEmail = getAdminEmail(req);
    const updatedSubmission = await requestRevisionForSubmission(
      id,
      adminEmail,
      revisionData
    );
    
    res.json({
      success: true,
      message: 'Revision requested successfully',
      submission: updatedSubmission
    });
  } catch (err) {
    console.error('Error requesting revision:', err);
    res.status(500).send(err.message);
  }
});

// Bulk verify submissions
app.post('/api/admin/submissions/bulk-verify', requireAdminAuthApi, async (req, res) => {
  try {
    const { submission_ids } = req.body;
    
    if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'submission_ids must be a non-empty array'
      });
    }
    
    const adminEmail = getAdminEmail(req);
    const results = [];
    
    for (const submissionId of submission_ids) {
      try {
        const verified = await verifySubmissionForAdmin(submissionId, adminEmail);
        results.push({ id: submissionId, success: true, submission: verified });
      } catch (err) {
        results.push({ id: submissionId, success: false, error: err.message });
      }
    }
    
    res.json({
      success: true,
      results,
      total_processed: submission_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (err) {
    console.error('Error in bulk verify:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Bulk reject submissions
app.post('/api/admin/submissions/bulk-reject', requireAdminAuthApi, async (req, res) => {
  try {
    const { submission_ids } = req.body;
    
    if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'submission_ids must be a non-empty array'
      });
    }
    
    const adminEmail = getAdminEmail(req);
    const results = [];
    
    for (const submissionId of submission_ids) {
      try {
        const { data: updated, error } = await supabase
          .from('submissions')
          .update({ 
            status: 'rejected',
            rejected_at: new Date().toISOString(),
            rejected_by: adminEmail,
            updated_at: new Date().toISOString()
          })
          .eq('id', submissionId)
          .select()
          .single();
          
        if (error) throw error;
        
        results.push({ id: submissionId, success: true, submission: updated });
      } catch (err) {
        results.push({ id: submissionId, success: false, error: err.message });
      }
    }
    
    res.json({
      success: true,
      results,
      total_processed: submission_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (err) {
    console.error('Error in bulk reject:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Bulk assign reviewer (placeholder for now)
app.post('/api/admin/submissions/bulk-assign-reviewer', requireAdminAuthApi, async (req, res) => {
  try {
    const { submission_ids, reviewer_id } = req.body;
    
    if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'submission_ids must be a non-empty array'
      });
    }
    
    if (!reviewer_id) {
      return res.status(400).json({
        success: false,
        error: 'reviewer_id is required'
      });
    }
    
    const adminEmail = getAdminEmail(req);
    const results = [];
    
    for (const submissionId of submission_ids) {
      try {
        const review = await assignReviewerToSubmission(submissionId, reviewer_id, adminEmail);
        results.push({ id: submissionId, success: true, review });
      } catch (err) {
        results.push({ id: submissionId, success: false, error: err.message });
      }
    }
    
    res.json({
      success: true,
      results,
      total_processed: submission_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (err) {
    console.error('Error in bulk assign reviewer:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Reject submission endpoint
app.post('/api/admin/submissions/:id/reject', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;
    const rejectionData = req.body;

    if (!id) {
      return res.status(400).send('Valid submission ID is required');
    }

    const adminEmail = getAdminEmail(req);
    const rejectedSubmission = await rejectSubmissionForAdmin(
      id,
      adminEmail,
      rejectionData
    );
    
    res.json({
      success: true,
      message: 'Submission rejected successfully',
      submission: rejectedSubmission
    });
  } catch (err) {
    console.error('Error rejecting submission:', err);
    res.status(500).send(err.message);
  }
});

// Enhanced submissions list endpoint (replaces existing one)
app.get('/api/admin/submissions/enhanced', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    // Extract query parameters
    const {
      status,
      paper_type,
      is_verified,
      author_email,
      title,
      created_after,
      created_before,
      has_reviewers,
      limit = 20,
      offset = 0
    } = req.query;
    
    const filters = {
      status: status ? (status.includes(',') ? status.split(',') : status) : undefined,
      paper_type,
      is_verified: is_verified !== undefined ? JSON.parse(is_verified) : undefined,
      author_email,
      title,
      created_after,
      created_before,
      has_reviewers: has_reviewers !== undefined ? JSON.parse(has_reviewers) : undefined
    };
    
    // Remove undefined values
    Object.keys(filters).forEach(key => 
      filters[key] === undefined && delete filters[key]
    );
    const adminEmail = getAdminEmail(req);
    const result = await getSubmissionsForAdmin(
      filters, 
      parseInt(limit), 
      parseInt(offset),
      adminEmail
    );
    
    res.json(result);
  } catch (err) {
    console.error('Error fetching enhanced submissions for admin:', err);
    res.status(500).send(err.message);
  }
});

import {
  getReviewersForAdmin,
  getReviewerProfileForAdmin,
  verifyReviewerForAdmin,
  rejectReviewerForAdmin,
  getReviewersByExpertise
} from './src/services/admin-reviewer-service.js';

// Enhanced reviewers list endpoint
app.get('/api/admin/reviewers/enhanced', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const adminEmail = getAdminEmail(req);
    const {
      status,
      search,
      institution,
      expertise,
      hasReviews,
      createdAfter,
      createdBefore,
      limit = 20,
      offset = 0
    } = req.query;

    const filters = {
      status: status ? (status.includes(',') ? status.split(',') : status) : undefined,
      search,
      institution,
      expertise_area: expertise,
      has_reviews: hasReviews !== undefined ? JSON.parse(hasReviews) : undefined,
      created_after: createdAfter,
      created_before: createdBefore
    };

    Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

    const result = await getReviewersForAdmin(
      filters,
      parseInt(limit),
      parseInt(offset),
      adminEmail
    );

    res.json({
      success: true,
      reviewers: result.data,
      pagination: result.pagination,
      filters_applied: result.filters_applied
    });
  } catch (err) {
    console.error('Error fetching enhanced reviewers for admin:', err);
    res.status(500).send(err.message);
  }
});

// Get detailed reviewer profile
app.get('/api/admin/reviewers/:email/profile', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    const rawEmailParam = req.params.email ?? '';
    let decodedEmailParam;
    try {
      decodedEmailParam = decodeURIComponent(rawEmailParam);
    } catch (decodeError) {
      decodedEmailParam = rawEmailParam;
    }

    const emailIdentifier = decodedEmailParam.trim();

    if (!emailIdentifier) {
      return res.status(400).send('Reviewer email is required');
    }

    const adminEmail = getAdminEmail(req);
    const reviewerProfile = await getReviewerProfileForAdmin(emailIdentifier, adminEmail);

    res.json(reviewerProfile);
  } catch (err) {
    console.error('Error fetching reviewer profile for admin:', err);
    if (err.message.includes('not found')) {
      res.status(404).send(err.message);
    } else {
      res.status(500).send(err.message);
    }
  }
});

// Verify/approve reviewer application
app.post('/api/admin/reviewers/:email/verify', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    const rawEmailParam = req.params.email ?? '';
    let decodedEmailParam;
    try {
      decodedEmailParam = decodeURIComponent(rawEmailParam);
    } catch (decodeError) {
      decodedEmailParam = rawEmailParam;
    }

    const emailIdentifier = decodedEmailParam.trim();
    const verificationData = req.body;

    if (!emailIdentifier) {
      return res.status(400).send('Reviewer email is required');
    }

    const adminEmail = getAdminEmail(req);
    const verifiedReviewer = await verifyReviewerForAdmin(emailIdentifier, adminEmail, verificationData);

    res.json({
      success: true,
      message: 'Reviewer verified successfully',
      reviewer: verifiedReviewer
    });
  } catch (err) {
    console.error('Error verifying reviewer:', err);
    res.status(500).send(err.message);
  }
});

// Reject reviewer application
app.post('/api/admin/reviewers/:email/reject', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    const rawEmailParam = req.params.email ?? '';
    let decodedEmailParam;
    try {
      decodedEmailParam = decodeURIComponent(rawEmailParam);
    } catch (decodeError) {
      decodedEmailParam = rawEmailParam;
    }

    const emailIdentifier = decodedEmailParam.trim();
    const rejectionData = req.body;

    if (!emailIdentifier) {
      return res.status(400).send('Reviewer email is required');
    }

    if (!rejectionData.reason) {
      return res.status(400).send('Rejection reason is required');
    }

    const adminEmail = getAdminEmail(req);
    const rejectedReviewer = await rejectReviewerForAdmin(emailIdentifier, adminEmail, rejectionData);

    res.json({
      success: true,
      message: 'Reviewer application rejected',
      reviewer: rejectedReviewer
    });
  } catch (err) {
    console.error('Error rejecting reviewer:', err);
    res.status(500).send(err.message);
  }
});

// Get reviewers by expertise for assignment recommendations
app.post('/api/admin/reviewers/recommendations', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware

    
    const { keywords } = req.body;
    
    if (!keywords || !Array.isArray(keywords)) {
      return res.status(400).send('Keywords array is required');
    }
    
    const recommendations = await getReviewersByExpertise(keywords);
    
    res.json({
      keywords,
      recommendations
    });
  } catch (err) {
    console.error('Error fetching reviewer recommendations:', err);
    res.status(500).send(err.message);
  }
});

// ==================== ENHANCED ADMIN REVIEW MANAGEMENT ENDPOINTS ====================

// Import enhanced admin review service
import {
  getSubmissionReviewsForAdmin,
  getReviewDetailsForAdmin,
  completeReviewForAdmin,
  sendReviewReminderForAdmin,
  reassignReviewForAdmin,
  getReviewStatistics,
  getOverdueReviews
} from './src/services/admin-review-service.js';

// Get all reviews for a specific submission
app.get('/api/admin/submissions/:id/reviews', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware
    
    const submissionId = req.params.id;

    if (!submissionId) {
      return res.status(400).send('Invalid submission ID');
    }

    const adminEmail = getAdminEmail(req);
    const reviews = await getSubmissionReviewsForAdmin(submissionId, adminEmail);
    
    res.json({
      submission_id: submissionId,
      reviews,
      total_count: reviews.length
    });
  } catch (err) {
    console.error('Error fetching submission reviews:', err);
    res.status(500).send(err.message);
  }
});

// Get overdue reviews
app.get('/api/admin/reviews/overdue', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware
    
    const adminEmail = getAdminEmail(req);
    const overdueReviews = await getOverdueReviews(adminEmail);
    
    res.json({
      overdue_reviews: overdueReviews,
      total_count: overdueReviews.length
    });
  } catch (err) {
    console.error('Error fetching overdue reviews:', err);
    res.status(500).send(err.message);
  }
});

// Get recent audit activity (placeholder endpoint for dashboard)
app.get('/api/admin/audit/recent', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication is handled by requireAdminAuthApi middleware
    const { limit = 10 } = req.query;
    
    // For now, return placeholder audit activities
    // In a real implementation, you'd have an audit_logs table
    const recentActivities = [
      {
        id: 1,
        action: 'submission_verified',
        user_id: 'admin',
        description: 'Verified submission "AI in healthcare"',
        timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString() // 30 mins ago
      },
      {
        id: 2,
        action: 'reviewer_assigned',
        user_id: 'admin',
        description: 'Assigned reviewer to submission "Machine Learning Applications"',
        timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString() // 1 hour ago
      },
      {
        id: 3,
        action: 'submission_published',
        user_id: 'admin',
        description: 'Published submission "Data Science Trends"',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() // 2 hours ago
      },
      {
        id: 4,
        action: 'reviewer_approved',
        user_id: 'admin',
        description: 'Approved new reviewer application',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString() // 4 hours ago
      },
      {
        id: 5,
        action: 'submission_rejected',
        user_id: 'admin',
        description: 'Rejected submission after review',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString() // 6 hours ago
      }
    ];
    
    res.json({
      success: true,
      data: recentActivities.slice(0, parseInt(limit))
    });
  } catch (err) {
    console.error('Error fetching audit activities:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get detailed submission information for admin
app.get('/api/admin/submissions/:id', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).send('Valid submission ID is required');
    }

    const adminEmail = getAdminEmail(req);
    const submissionDetails = await getSubmissionDetailsForAdmin(id, adminEmail);
    
    res.json(submissionDetails);
  } catch (err) {
    console.error('Error fetching submission details for admin:', err);
    if (err.message.includes('not found')) {
      res.status(404).send(err.message);
    } else {
      res.status(500).send(err.message);
    }
  }
});

// Add missing statistics endpoints for dashboard
app.get('/api/admin/submissions/statistics', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const { data: submissions, error } = await supabase
      .from('submissions')
      .select('status, created_at');
      
    if (error) {
      console.error('Error fetching submission statistics:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch submission statistics'
      });
    }

    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Get overdue submissions from reviews table
    const { data: reviews } = await supabase
      .from('reviews')
      .select('due_date, status')
      .lt('due_date', now.toISOString())
      .neq('status', 'COMPLETED') || [];
    
    const stats = {
      total_submissions: submissions.length,
      pending_submissions: submissions.filter(s => s.status === 'submitted' || s.status === 'pending').length,
      under_review_submissions: submissions.filter(s => s.status === 'under_review').length,
      accepted_submissions: submissions.filter(s => s.status === 'accepted').length,
      rejected_submissions: submissions.filter(s => s.status === 'rejected').length,
      published_submissions: submissions.filter(s => s.status === 'published').length,
      ready_to_publish: submissions.filter(s => s.status === 'accepted' || s.status === 'ready_to_publish').length,
      overdue_submissions: reviews?.length || 0,
      new_this_month: submissions.filter(s => new Date(s.created_at) >= thisMonth).length
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error in submissions statistics endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get reviews for a specific submission
app.get('/api/admin/submissions/:id/reviews', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).send('Valid submission ID is required');
    }

    const { data: reviews, error } = await supabase
      .from('reviews')
      .select(`
        *,
        reviewer:reviewer_applications(
          full_name,
          applicant_email,
          institution
        )
      `)
      .eq('submission_id', id)
      .order('assigned_at', { ascending: false });

    if (error) {
      // If reviews table doesn't exist, return empty array
      console.log('Reviews table not found, returning empty reviews');
      return res.json({
        success: true,
        reviews: []
      });
    }

    res.json({
      success: true,
      reviews: reviews || []
    });
  } catch (err) {
    console.error('Error fetching submission reviews:', err);
    res.status(500).send(err.message);
  }
});

// Get reviewer recommendations for a submission
app.get('/api/admin/reviewers/recommendations', requireAdminAuthApi, async (req, res) => {
  try {
    const { keywords, submissionId } = req.query;
    
    // Get submission owner email if submissionId is provided
    let submissionOwnerEmail = null;
    if (submissionId) {
      const { data: submission, error: submissionError } = await supabase
        .from('submissions')
        .select('owner_email, first_author_email')
        .eq('id', submissionId)
        .single();
      
      if (!submissionError && submission) {
        submissionOwnerEmail = (submission.owner_email || submission.first_author_email)?.toLowerCase();
      }
    }
    
    // Get approved reviewers with their active review count
    const { data: reviewers, error } = await supabase
      .from('reviewer_applications')
      .select(`
        id, 
        full_name, 
        applicant_email, 
        institution, 
        degree, 
        experience, 
        status, 
        expertise_keywords_text,
        reviews:reviews!reviewer_id(
          id,
          status,
          submission_id
        )
      `)
      .eq('status', 'APPROVED')
      .order('full_name', { ascending: true });

    if (error) {
      console.error('Error fetching reviewer recommendations:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch reviewer recommendations'
      });
    }

    // Format for frontend expectations
    const recommendations = (reviewers || []).map(reviewer => {
      // Parse expertise keywords from text field
      let expertiseAreas = [];
      if (reviewer.expertise_keywords_text) {
        expertiseAreas = reviewer.expertise_keywords_text
          .split(',')
          .map(area => area.trim())
          .filter(area => area);
      }
      // Fall back to degree if no expertise keywords
      if (expertiseAreas.length === 0 && reviewer.degree) {
        expertiseAreas = [reviewer.degree];
      }

      // Calculate active workload
      const activeReviews = (reviewer.reviews || []).filter(review => 
        review.status === 'PENDING' || review.status === 'IN_PROGRESS'
      );

      // Check if reviewer is already assigned to this specific submission
      const isAlreadyAssigned = submissionId && (reviewer.reviews || []).some(review => 
        review.submission_id === submissionId
      );

      // Check if reviewer's email matches submission owner's email
      const isSubmissionOwner = submissionOwnerEmail && 
        reviewer.applicant_email?.toLowerCase() === submissionOwnerEmail;

      return {
        id: reviewer.id,
        full_name: reviewer.full_name,
        applicant_email: reviewer.applicant_email,
        institution: reviewer.institution,
        expertise_areas: expertiseAreas,
        workload: activeReviews.length,
        isAlreadyAssigned: isAlreadyAssigned,
        isSubmissionOwner: isSubmissionOwner
      };
    });

    // Filter out already assigned reviewers and submission owners
    const filteredRecommendations = recommendations.filter(reviewer => {
      if (submissionId && reviewer.isAlreadyAssigned) return false;
      if (reviewer.isSubmissionOwner) return false;
      return true;
    });

    res.json({
      success: true,
      recommendations: filteredRecommendations
    });
  } catch (err) {
    console.error('Error fetching reviewer recommendations:', err);
    res.status(500).send(err.message);
  }
});

app.get('/api/admin/reviewers/statistics', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const { data: reviewers, error } = await supabase
      .from('reviewer_applications')
      .select('status, created_at');
      
    if (error) {
      console.error('Error fetching reviewer statistics:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch reviewer statistics'
      });
    }

    const normalizeReviewerStatus = status => (status || '').toUpperCase();

    const stats = {
      total_reviewers: reviewers.length,
      verified_reviewers: reviewers.filter(r => normalizeReviewerStatus(r.status) === 'APPROVED').length,
      pending_reviewers: reviewers.filter(r => normalizeReviewerStatus(r.status) === 'PENDING').length,
      rejected_reviewers: reviewers.filter(r => normalizeReviewerStatus(r.status) === 'REJECTED').length
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error in reviewers statistics endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/api/admin/reviews/statistics', [requireAdminAuthApi, validateApiParams], async (req, res) => {
  try {
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('status, due_date, completed_at, created_at');
      
    if (error) {
      // If reviews table doesn't exist yet, return placeholder data
      console.log('Reviews table not found, returning placeholder data');
      return res.json({
        success: true,
        data: {
          total_reviews: 0,
          completed_reviews: 0,
          in_progress_reviews: 0,
          pending_reviews: 0,
          overdue_reviews: 0
        }
      });
    }

    const now = new Date();
    const normalizeReviewStatus = status => (status || '').toUpperCase();

    const stats = {
      total_reviews: reviews.length,
      completed_reviews: reviews.filter(r => normalizeReviewStatus(r.status) === 'COMPLETED' && r.completed_at).length,
      in_progress_reviews: reviews.filter(r => normalizeReviewStatus(r.status) === 'IN_PROGRESS').length,
      pending_reviews: reviews.filter(r => normalizeReviewStatus(r.status) === 'PENDING').length,
      overdue_reviews: reviews.filter(r => 
        normalizeReviewStatus(r.status) !== 'COMPLETED' && r.due_date && new Date(r.due_date) < now
      ).length
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error in reviews statistics endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get detailed review information
app.get('/api/admin/reviews/:id', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware
    const reviewId = req.params.id; // UUID string

    if (!reviewId) {
      return res.status(400).send('Invalid review ID');
    }

    const adminEmail = getAdminEmail(req);
    const review = await getReviewDetailsForAdmin(reviewId, adminEmail);

    res.json(review);
  } catch (err) {
    console.error('Error fetching review details:', err);
    res.status(500).send(err.message);
  }
});

// Complete a review (admin override)
app.post('/api/admin/reviews/:id/complete', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware
    const reviewId = req.params.id; // UUID string

    if (!reviewId) {
      return res.status(400).send('Invalid review ID');
    }

    const { score, comments, feedback, recommendation } = req.body;

    const completionData = {};
    if (score !== undefined) completionData.score = score;
    if (comments) completionData.comments = comments;
    if (feedback) completionData.feedback = feedback;
    if (recommendation) completionData.recommendation = recommendation;

    const adminEmail = getAdminEmail(req);
    const updatedReview = await completeReviewForAdmin(reviewId, adminEmail, completionData);

    res.json({
      message: 'Review completed successfully',
      review: updatedReview
    });
  } catch (err) {
    console.error('Error completing review:', err);
    res.status(500).send(err.message);
  }
});

// Send reminder to reviewer
app.post('/api/admin/reviews/:id/reminder', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware
    const reviewId = req.params.id; // UUID string

    if (!reviewId) {
      return res.status(400).send('Invalid review ID');
    }

    const { message } = req.body;

    const reminderData = {};
    if (message) reminderData.message = message;

    const adminEmail = getAdminEmail(req);
    const updatedReview = await sendReviewReminderForAdmin(reviewId, adminEmail, reminderData);

    res.json({
      message: 'Reminder sent successfully',
      review: updatedReview
    });
  } catch (err) {
    console.error('Error sending reminder:', err);
    res.status(500).send(err.message);
  }
});

// Bulk operations for submissions
app.post('/api/admin/submissions/bulk-verify', requireAdminAuthApi, async (req, res) => {
  try {
    const { submission_ids } = req.body;
    
    if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'submission_ids must be a non-empty array'
      });
    }
    
    const adminEmail = getAdminEmail(req);
    const results = [];
    
    for (const submissionId of submission_ids) {
      try {
        const verified = await verifySubmissionForAdmin(submissionId, adminEmail);
        results.push({ id: submissionId, success: true, submission: verified });
      } catch (err) {
        results.push({ id: submissionId, success: false, error: err.message });
      }
    }
    
    res.json({
      success: true,
      results,
      total_processed: submission_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (err) {
    console.error('Error in bulk verify:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.post('/api/admin/submissions/bulk-reject', requireAdminAuthApi, async (req, res) => {
  try {
    const { submission_ids } = req.body;
    
    if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'submission_ids must be a non-empty array'
      });
    }
    
    const adminEmail = getAdminEmail(req);
    const results = [];
    
    for (const submissionId of submission_ids) {
      try {
        const { data: updated, error } = await supabase
          .from('submissions')
          .update({ 
            status: 'rejected',
            rejected_at: new Date().toISOString(),
            rejected_by: adminEmail,
            updated_at: new Date().toISOString()
          })
          .eq('id', submissionId)
          .select()
          .single();
          
        if (error) throw error;
        
        results.push({ id: submissionId, success: true, submission: updated });
      } catch (err) {
        results.push({ id: submissionId, success: false, error: err.message });
      }
    }
    
    res.json({
      success: true,
      results,
      total_processed: submission_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (err) {
    console.error('Error in bulk reject:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.post('/api/admin/submissions/bulk-assign-reviewer', requireAdminAuthApi, async (req, res) => {
  try {
    const { submission_ids, reviewer_id } = req.body;
    
    if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'submission_ids must be a non-empty array'
      });
    }
    
    if (!reviewer_id) {
      return res.status(400).json({
        success: false,
        error: 'reviewer_id is required'
      });
    }
    
    const adminEmail = getAdminEmail(req);
    const results = [];
    
    for (const submissionId of submission_ids) {
      try {
        const review = await assignReviewerToSubmission(submissionId, reviewer_id, adminEmail);
        results.push({ id: submissionId, success: true, review });
      } catch (err) {
        results.push({ id: submissionId, success: false, error: err.message });
      }
    }
    
    res.json({
      success: true,
      results,
      total_processed: submission_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (err) {
    console.error('Error in bulk assign reviewer:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Bulk publish submissions
app.post('/api/admin/submissions/bulk-publish', requireAdminAuthApi, async (req, res) => {
  try {
    const { submission_ids } = req.body;
    
    if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'submission_ids must be a non-empty array'
      });
    }
    
    const adminEmail = getAdminEmail(req);
    const results = [];
    
    for (const submissionId of submission_ids) {
      try {
        // Check if submission is ready to publish
        const { data: submission, error: fetchError } = await supabase
          .from('submissions')
          .select('status')
          .eq('id', submissionId)
          .single();
          
        if (fetchError || !submission) {
          results.push({ id: submissionId, success: false, error: 'Submission not found' });
          continue;
        }
        
        if (!['accepted', 'ready_to_publish'].includes(submission.status)) {
          results.push({ id: submissionId, success: false, error: 'Submission not ready for publishing' });
          continue;
        }
        
        const published = await publishSubmissionForAdmin(submissionId, adminEmail);
        results.push({ id: submissionId, success: true, submission: published });
      } catch (err) {
        results.push({ id: submissionId, success: false, error: err.message });
      }
    }
    
    res.json({
      success: true,
      results,
      total_processed: submission_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (err) {
    console.error('Error in bulk publish:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Removed old signed URL endpoints - now using direct file serving approach

// Simple direct file serving endpoints for papers (using direct URLs like CV approach)
app.get('/api/admin/files/serve/:fileId', requireAdminAuthApi, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId) {
      return res.status(400).json({
        success: false,
        error: 'File ID is required'
      });
    }
    
    // Get file info from submission_files table
    const { data: fileInfo, error: fileError } = await supabase
      .from('submission_files')
      .select('storage_key, original_filename')
      .eq('id', fileId)
      .single();
    
    if (fileError || !fileInfo) {
      console.error('Error finding file info:', fileError);
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    // Simply redirect to the storage URL (like CV approach)
    if (fileInfo.storage_key) {
      res.redirect(fileInfo.storage_key);
    } else {
      return res.status(404).json({
        success: false,
        error: 'File URL not available'
      });
    }
    
  } catch (err) {
    console.error('Error in file serve endpoint:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Download endpoint (force download instead of inline)
app.get('/api/admin/files/download-direct/:fileId', requireAdminAuthApi, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId) {
      return res.status(400).json({
        success: false,
        error: 'File ID is required'
      });
    }
    
    // Get file info from submission_files table
    const { data: fileInfo, error: fileError } = await supabase
      .from('submission_files')
      .select('storage_key, original_filename')
      .eq('id', fileId)
      .single();
    
    if (fileError || !fileInfo) {
      console.error('Error finding file info:', fileError);
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    // For downloads, we'll still redirect but add headers to force download
    if (fileInfo.storage_key) {
      res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.original_filename}"`);
      res.redirect(fileInfo.storage_key);
    } else {
      return res.status(404).json({
        success: false,
        error: 'File URL not available'
      });
    }
    
  } catch (err) {
    console.error('Error in file download endpoint:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get submission files endpoint for admin
app.get('/api/admin/submissions/:id/files', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required'
      });
    }
    
    // Get files for the submission
    const { data: files, error } = await supabase
      .from('submission_files')
      .select('*')
      .eq('submission_id', id)
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error fetching submission files:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch submission files'
      });
    }
    
    res.json({
      success: true,
      files: files || []
    });
  } catch (err) {
    console.error('Error in submission files endpoint:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Reassign review to different reviewer
app.post('/api/admin/reviews/:id/reassign', requireAdminAuthApi, async (req, res) => {
  try {
    // Admin authentication handled by requireAdminAuthApi middleware
    const reviewId = req.params.id; // UUID string

    if (!reviewId) {
      return res.status(400).send('Invalid review ID');
    }

    const { new_reviewer_id, reason, new_due_date } = req.body;

    if (!new_reviewer_id) {
      return res.status(400).send('New reviewer ID is required');
    }

    const reassignmentData = {};
    if (reason) reassignmentData.reason = reason;
    if (new_due_date) reassignmentData.new_due_date = new_due_date;

    const adminEmail = getAdminEmail(req);
    const updatedReview = await reassignReviewForAdmin(reviewId, new_reviewer_id, adminEmail, reassignmentData);

    res.json({
      message: 'Review reassigned successfully',
      review: updatedReview
    });
  } catch (err) {
    console.error('Error reassigning review:', err);
    res.status(500).send(err.message);
  }
});

// === REVIEW FORM ROUTES ===

// Import the review service
import { 
  getReviewBySubmissionForUser, 
  submitReview, 
  startReview, 
  getReviewsForReviewer, 
  canUserReviewSubmission,
  getReviewById,
  getReviewsByReviewerId,
  getReviewsBySubmissionId
} from './src/services/review-service.js';

// Route to serve the review form for a specific submission
app.get('/review/:submissionId', requiresAuth(), async (req, res) => {
  try {
    const submissionId = req.params.submissionId; // Keep as UUID string
    const userEmail = req.oidc.user?.email;

    if (!submissionId) {
      return res.status(400).send('Invalid submission ID');
    }

    if (!userEmail) {
      return res.status(401).send('User not authenticated');
    }

    // Check if user has permission to review this submission
    const canReview = await canUserReviewSubmission(submissionId, userEmail);
    if (!canReview) {
      return res.status(403).send('You are not assigned to review this submission');
    }

    // Serve the review form
    res.sendFile(path.join(__dirname, 'src', 'views', 'feedreviewform.html'));
  } catch (error) {
    console.error('Error serving review form:', error);
    res.status(500).send('Internal server error');
  }
});

// API endpoint to get review data by review ID (for editing specific review)
app.get('/api/review/id/:reviewId', requireAuthApi, async (req, res) => {
  try {
    const reviewId = req.params.reviewId; // UUID string
    const userEmail = req.oidc.user?.email;

    console.log('Getting review by ID:', reviewId, 'for user:', userEmail);

    if (!reviewId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid review ID'
      });
    }

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    // Get the specific review
    const review = await getReviewById(reviewId);
    
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    // Verify the user is the assigned reviewer
    const reviewerApp = await getReviewerApplicationByEmail(userEmail);
    if (!reviewerApp || review.reviewer_id !== reviewerApp.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied - you are not assigned to this review'
      });
    }

    res.json({
      success: true,
      review
    });
  } catch (error) {
    console.error('Error fetching review by ID:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch review data'
    });
  }
});

// API endpoint to get all reviews assigned to the current reviewer
app.get('/api/reviewer/reviews', requireAuthApi, async (req, res) => {
  try {
    const userEmail = req.oidc.user?.email;

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    // Get reviewer application
    const reviewerApp = await getReviewerApplicationByEmail(userEmail);
    if (!reviewerApp) {
      return res.status(403).json({
        success: false,
        error: 'User is not a registered reviewer'
      });
    }

    // Get all reviews for this reviewer
    const reviews = await getReviewsByReviewerId(reviewerApp.id);

    res.json({
      success: true,
      reviews,
      reviewer: {
        id: reviewerApp.id,
        name: reviewerApp.full_name,
        email: reviewerApp.applicant_email
      }
    });
  } catch (error) {
    console.error('Error fetching reviewer reviews:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reviewer reviews'
    });
  }
});

// API endpoint to get review data for a specific submission (using submission_id + reviewer matching)
app.get('/api/review/:submissionId', requireAuthApi, async (req, res) => {
  try {
    const submissionId = req.params.submissionId; // Keep as UUID string
    const userEmail = req.oidc.user?.email;

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid submission ID'
      });
    }

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    // Get the review data
    const review = await getReviewBySubmissionForUser(submissionId, userEmail);
    
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review assignment not found'
      });
    }

    res.json({
      success: true,
      review
    });
  } catch (error) {
    console.error('Error fetching review data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch review data'
    });
  }
});

// API endpoint to submit a review
app.post('/api/review/:submissionId', requireAuthApi, async (req, res) => {
  try {
    const submissionId = req.params.submissionId; // Keep as UUID string
    const userEmail = req.oidc.user?.email;
    const reviewData = req.body;

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid submission ID'
      });
    }

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    // Validate required fields
    const requiredFields = ['originality', 'relevance', 'literature', 'methodology', 'analysis', 'clarity', 'presentation', 'significance', 'recommendation'];
    const missingFields = requiredFields.filter(field => !reviewData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Submit the review
    const savedReview = await submitReview(submissionId, userEmail, reviewData);

    res.json({
      success: true,
      message: 'Review submitted successfully',
      review: savedReview
    });
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to submit review'
    });
  }
});

// API endpoint to start a review (mark as in-progress)
app.post('/api/review/:submissionId/start', requireAuthApi, async (req, res) => {
  try {
    const submissionId = req.params.submissionId; // Keep as UUID string
    const userEmail = req.oidc.user?.email;

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid submission ID'
      });
    }

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    // Start the review
    const review = await startReview(submissionId, userEmail);

    res.json({
      success: true,
      message: 'Review started successfully',
      review
    });
  } catch (error) {
    console.error('Error starting review:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start review'
    });
  }
});

// Get assigned submissions for reviewer dashboard (returns submissions with review data)
app.get('/api/assigned-submissions', requireAuthApi, async (req, res) => {
  try {
    // Get user from Auth0
    const auth0User = req.oidc.user;
    
    if (!auth0User?.email) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }
    
    // Check if user is reviewer using email
    const reviewerProfile = await getReviewerApplicationByEmail(auth0User.email);
    if (!reviewerProfile || reviewerProfile.status !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        error: 'Not authorized - user is not an approved reviewer'
      });
    }
    
    // Get submissions assigned to this reviewer
    const { data: submissions, error } = await supabase
      .from('submissions')
      .select(`
        *,
        reviews!inner(*),
        submission_files(
          id,
          storage_key,
          original_filename,
          mime_type
        )
      `)
      .eq('reviews.reviewer_id', String(reviewerProfile.id));
      
    if (error) {
      console.error('Error fetching assigned submissions:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch assigned submissions'
      });
    }
    
    res.json(submissions || []);
  } catch (err) {
    console.error('Error fetching assigned submissions:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assigned submissions'
    });
  }
});

// === END REVIEW FORM ROUTES ===

// Download published submission PDF
app.get('/api/submissions/:id/download', requireAdminAuthApi, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required'
      });
    }

    // Get submission details
    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select(`
        id,
        title,
        status,
        submission_files(
          id,
          storage_key,
          original_filename,
          mime_type
        )
      `)
      .eq('id', id)
      .eq('status', 'published')
      .single();

    if (submissionError || !submission) {
      console.error('Error fetching submission for download:', submissionError);
      return res.status(404).json({
        success: false,
        error: 'Published submission not found'
      });
    }

    // Find the main PDF file
    const pdfFile = submission.submission_files?.find(file => 
      file.mime_type === 'application/pdf' || 
      file.original_filename?.toLowerCase().endsWith('.pdf')
    );

    if (!pdfFile || !pdfFile.storage_key) {
      return res.status(404).json({
        success: false,
        error: 'PDF file not found for this submission'
      });
    }

    // Redirect to the storage URL
    res.redirect(pdfFile.storage_key);

  } catch (err) {
    console.error('Error in submission download endpoint:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Server configured with:');
  console.log('- Custom authentication enabled');
  console.log('- Static files served from public/ and src/views/');
  console.log('- Backward compatibility redirects enabled');
});

export default app;

