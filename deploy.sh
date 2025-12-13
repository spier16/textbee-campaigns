#!/bin/bash

# Deployment script for textbee-campaigns
# Usage: ./deploy.sh

set -e  # Exit on error

echo "======================================"
echo "🚀 Starting deployment..."
echo "======================================"

# Pull latest images from GHCR
echo ""
echo "📦 Pulling latest images..."
docker compose -f docker-compose.prebuilt.yaml pull

# Restart containers
echo ""
echo "🔄 Restarting containers..."
docker compose -f docker-compose.prebuilt.yaml down
docker compose -f docker-compose.prebuilt.yaml up -d

# Wait for containers to be healthy
echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check container status
echo ""
echo "📊 Container status:"
docker compose -f docker-compose.prebuilt.yaml ps

# Clean up old images
echo ""
echo "🧹 Cleaning up old Docker images..."
docker image prune -a --force

# Show disk usage
echo ""
echo "💾 Disk usage after cleanup:"
docker system df
df -h / | grep -E '^Filesystem|^/dev/root'

echo ""
echo "======================================"
echo "✅ Deployment complete!"
echo "======================================"
