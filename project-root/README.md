# Digital evolution journal

A premier peer-reviewed publication platform for cutting-edge technical research, featuring a 10-reviewer system and AI-powered paper matching.

## 🚀 Features

- **Research Paper Submission**: Submit research papers and white papers with automated format validation
- **Expert Reviewer System**: 10-expert reviewer assignment with AI-powered matching
- **File Management**: Secure file upload and storage using Supabase Storage
- **User Management**: Author and reviewer profiles with role-based access
- **Modern UI**: Responsive design with Tailwind CSS
- **Cloud-Native**: Built on Azure Web Apps and Supabase (PostgreSQL and Storage)

## 🏗️ Architecture

- **Frontend**: Static HTML with Tailwind CSS, served via Azure Web Apps
- **Backend**: Node.js Express server
- **Database**: Supabase PostgreSQL database (previously Azure Cosmos DB)
- **Storage**: Supabase Storage for file uploads (previously Azure Blob Storage)
- **Authentication**: Auth0 integration
- **Deployment**: Azure Web Apps

## 📋 Prerequisites

- Node.js 18+
- Azure account
- Azure CLI (optional, for deployment)
- Auth0 account (for authentication)

## 🛠️ Setup

### 1. Clone and Install

```bash
git clone techmagazine
cd project-root
npm install
```

### 2. Environment Configuration

For development, copy the Supabase environment file template and configure your settings:

```bash
cp env.supabase.example .env
```

Edit the environment file with your Supabase configuration:

```env
# Supabase Configuration
SUPABASE_URL="https://your-project-id.supabase.co"
SUPABASE_KEY="your-supabase-anon-key"
SUPABASE_SERVICE_KEY="your-supabase-service-role-key"

# Auth0
AUTH0_SECRET="your-auth0-secret"
AUTH0_BASE_URL="http://localhost:3000" # For local development
# AUTH0_BASE_URL="https://your-azure-app-name.azurewebsites.net" # For production
AUTH0_CLIENT_ID="your-auth0-client-id"
AUTH0_CLIENT_SECRET="your-auth0-client-secret"
AUTH0_DOMAIN="your-auth0-domain"
```

**Note:** The legacy Azure environment files (`.azure.env.example` and `.env.production.azure`) are deprecated but kept for reference.

For detailed information about environment variables and file structure, see [Environment Files Documentation](docs/environment-files.md).

## 🧪 Testing

The application includes comprehensive test scripts to verify functionality after deployment:

### Supabase Connectivity Test

Test the connection to Supabase database and storage:

```bash
npm run test-supabase
```

### API Endpoint Tests

Test the API endpoints (requires authentication):

```bash
npm run test-api
```

For authenticated tests, you'll need to set the `SESSION_COOKIE` environment variable with a valid session cookie from a logged-in user.

### Redirect Tests

Test backward compatibility redirects:

```bash
npm run test-redirects
```

### Run All Tests

Run all tests in sequence:

```bash
npm test
```

### Generate Test Report

Run all tests and generate a detailed report:

```bash
npm run test-report
```

This will provide a summary of all test results, including pass/fail status and execution time.

# Auth0 (required)
AUTH0_SECRET="your-auth0-secret"
AUTH0_CLIENT_ID="your-auth0-client-id"
AUTH0_CLIENT_SECRET="your-auth0-client-secret"
AUTH0_DOMAIN="your-auth0-domain"
AUTH0_BASE_URL="http://localhost:3000"

# Azure Storage (for file uploads)
STORAGE_ACCOUNT_NAME="your-storage-account-name"
STORAGE_ACCOUNT_KEY="your-storage-account-key"
STORAGE_CONTAINER_NAME="papers"
```

### 3. Database Setup

Initialize the database:

```bash
npx prisma generate
npx prisma db push
```

### 4. Local Development

Start the development server:

```bash
npm run dev
```

Visit `http://localhost:3000`

## 🚀 Deployment

### Azure Web App Deployment

#### 1. Prerequisites

- Azure account with active subscription
- Azure CLI installed locally
- Git installed locally

#### 2. Environment Configuration

Copy the `.azure.env.example` file to `.env.production.azure` and fill in your values:

```bash
cp .azure.env.example .env.production.azure
# Edit the file with your Azure-specific configuration
```

Alternatively, if you have existing environment files, you can use the migration script to consolidate them:

```bash
npm run migrate-env
# This will create .env.production.azure from existing .env.production and .azure.env files
```

#### 3. Create Azure Resources

Create the necessary Azure resources using Azure CLI:

```bash
# Login to Azure
az login

# Create a resource group
az group create --name loramagazine-rg --location eastus

# Create an Azure Cosmos DB account with MongoDB API
az cosmosdb create --name loramagazine-db --resource-group loramagazine-rg --kind MongoDB

# Create a database in the Cosmos DB account
az cosmosdb mongodb database create --account-name loramagazine-db --name loramagazine --resource-group loramagazine-rg

# Create a storage account
az storage account create --name loramagazinestorage --resource-group loramagazine-rg --location eastus --sku Standard_LRS

# Create a storage container
az storage container create --name papers --account-name loramagazinestorage --auth-mode key

# Create an App Service plan
az appservice plan create --name loramagazine-plan --resource-group loramagazine-rg --sku B1

# Create a web app
az webapp create --name loramagazine --resource-group loramagazine-rg --plan loramagazine-plan --runtime "NODE|18-lts"
```
#### 4. Configure Web App Settings

Set the environment variables for your Azure Web App:

```bash
# Set environment variables from your .azure.env file
az webapp config appsettings set --resource-group loramagazine-rg --name loramagazine --settings @.azure.env
```

#### 5. Deploy Your Application

You have two options for deployment:

**Option 1: Deploy from local Git**

```bash
# Configure local Git deployment
az webapp deployment source config-local-git --name loramagazine --resource-group loramagazine-rg

# Get the Git remote URL
az webapp deployment list-publishing-profiles --name loramagazine --resource-group loramagazine-rg --query "[?publishMethod=='MSDeploy'].publishUrl" -o tsv

# Add the remote to your local Git repository
git remote add azure <publishing-url>

# Push to Azure
git push azure main
```

**Option 2: Deploy with GitHub Actions**

Use the included GitHub Actions workflow file (`.github/workflows/azure-deploy.yml`). You'll need to set up the following secrets in your GitHub repository:

- `AZURE_WEBAPP_NAME`: The name of your Azure Web App (e.g., loramagazine)
- `AZURE_WEBAPP_PUBLISH_PROFILE`: The publish profile from Azure Portal

To get the publish profile:
1. Go to your Web App in the Azure Portal
2. Click on "Get publish profile" and download the file
3. Add the contents of the file as a secret in your GitHub repository



## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.



```bash
wrangler pages deploy "src/views" --project-name lora-magz
```

### 6. Configure Pages Bindings

In Cloudflare Pages Dashboard:

1. Go to your project → Settings → Functions
2. Add D1 binding:
   - Variable name: `DB`
   - D1 database: `loramag`
3. Add R2 binding:
   - Variable name: `R2_BUCKET`
   - R2 bucket: `research`

## 📁 Project Structure

```
project-root/
├── src/
│   ├── views/           # Static HTML pages
│   │   ├── index.html
│   │   ├── submit.html
│   │   ├── reviewer.html
│   │   ├── login.html
│   │   ├── register.html
│   │   ├── dashboard-*.html
│   │   ├── _worker.js   # Pages Functions
│   │   └── _redirects   # URL routing
│   ├── controllers/     # Express controllers
│   ├── routes/          # Express routes
│   ├── middlewares/     # Express middlewares
│   ├── services/        # Business logic
│   ├── utils/           # Utility functions
│   └── config/
│       └── supabase.js  # Database connection
├── worker/
│   ├── index.js         # Cloudflare Worker
│   └── migrations/      # D1 database migrations
├── public/              # Static assets
├── config/              # Configuration files
├── server.js            # Express server (local dev)
├── wrangler.toml        # Cloudflare configuration
└── package.json
```

## 🔧 API Endpoints

### Public Endpoints

- `GET /api/me` - Get authentication status
- `GET /files/{key}` - Download uploaded files

### Protected Endpoints (when Auth0 configured)

- `POST /api/submissions` - Submit research paper
- `POST /api/reviewer-applications` - Apply as reviewer
- `POST /api/upload` - Upload files
- `POST /api/upload-binary` - Upload binary files

## 🎨 Pages

- `/` - Homepage with peer review process overview
- `/submit` - Research paper submission form
- `/reviewer` - Reviewer application form
- `/login` - Authentication page
- `/register` - Registration page
- `/dashboard/author` - Author dashboard
- `/dashboard/reviewer` - Reviewer dashboard
- `/admin` - Admin dashboard

## 🔒 Security

- File upload validation (type, size limits)
- CORS configuration for file access
- Optional Auth0 integration for authentication
- Database parameterized queries to prevent SQL injection

## 🧪 Testing

```bash
# Run tests (if configured)
npm test

# Test API endpoints
curl -X GET https://your-pages-url.pages.dev/api/me
```


## 📄 License

This project should not be used for any repurposing,reproducing,or modification without written consent of owner.

## 🔄 Version History

- **v1.0.0** - Initial release with basic submission and reviewer functionality
- **v1.1.0** - Added Cloudflare Pages deployment
- **v1.2.0** - Enhanced file upload and storage system
