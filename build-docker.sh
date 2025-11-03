#!/bin/bash

# Build script that ensures APK is copied before Docker build

set -e  # Exit on error

echo "Building TextBee services..."

# Copy production APK to web public folder
echo "Copying production APK..."
cd web
npm run copy-apk:prod
cd ..

# Build Docker images
echo "Building Docker images..."
docker compose build

echo "Build complete! Run 'docker compose up' to start services."
