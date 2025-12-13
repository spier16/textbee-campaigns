#!/bin/bash

# Docker cleanup script
# Removes old/unused Docker images to free disk space
# Safe to run - only removes unused resources

echo "======================================"
echo "🧹 Docker Cleanup"
echo "======================================"

echo ""
echo "📊 Current disk usage:"
docker system df
df -h / | grep -E '^Filesystem|^/dev/root'

echo ""
echo "🗑️  Removing unused Docker images..."
docker image prune -a --force

echo ""
echo "🗑️  Removing unused Docker volumes..."
docker volume prune --force

echo ""
echo "🗑️  Removing unused Docker networks..."
docker network prune --force

echo ""
echo "📊 Disk usage after cleanup:"
docker system df
df -h / | grep -E '^Filesystem|^/dev/root'

echo ""
echo "======================================"
echo "✅ Cleanup complete!"
echo "======================================"
