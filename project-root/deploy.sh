#!/bin/bash

# ----------------------
# Azure Web App Deployment Script
# ----------------------

# Stop on errors
set -e

echo "Starting deployment script for Lora Magazine application"

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Initialize Supabase schema if SUPABASE_URL is set
if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_KEY" ]; then
  echo "Initializing Supabase schema..."
  npm run init-supabase-schema
else
  echo "Skipping Supabase schema initialization - SUPABASE_URL or SUPABASE_KEY not set"
fi

# Build assets if needed
if [ -f "package.json" ] && grep -q "\"build\"" package.json; then
  echo "Building assets..."
  npm run build
fi

# Set production environment
export NODE_ENV=production

echo "Deployment script completed successfully"