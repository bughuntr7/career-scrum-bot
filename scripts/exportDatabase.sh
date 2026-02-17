#!/bin/bash
# Database Export Script for Migration to Windows
# This script exports your PostgreSQL database to a SQL dump file

set -e

# Load DATABASE_URL from .env file (safely)
if [ -f .env ]; then
    # Extract DATABASE_URL line and remove quotes if present
    DB_URL=$(grep "^DATABASE_URL=" .env | head -1 | cut -d'=' -f2- | sed 's/^"//;s/"$//')
else
    echo "❌ ERROR: .env file not found"
    exit 1
fi

if [ -z "$DB_URL" ]; then
    echo "❌ ERROR: DATABASE_URL not found in .env file"
    exit 1
fi

# Parse DATABASE_URL for display (basic parsing)
# Remove postgresql:// prefix
DB_URL_NO_PROTOCOL="${DB_URL#postgresql://}"
# Extract user:password
CREDENTIALS="${DB_URL_NO_PROTOCOL%%@*}"
DB_USER="${CREDENTIALS%%:*}"
# Extract host:port/database
HOST_DB="${DB_URL_NO_PROTOCOL#*@}"
DB_HOST="${HOST_DB%%:*}"
PORT_DB="${HOST_DB#*:}"
DB_PORT="${PORT_DB%%/*}"
DB_NAME="${PORT_DB#*/}"

# Remove any query parameters from DB_NAME
DB_NAME="${DB_NAME%%\?*}"

echo "📊 Database Export Script"
echo "=========================="
echo "Database: $DB_NAME"
echo "Host: $DB_HOST"
echo "Port: $DB_PORT"
echo "User: $DB_USER"
echo ""

# Generate filename with timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DUMP_FILE="jobbot_backup_${TIMESTAMP}.sql"
DUMP_FILE_CUSTOM="jobbot_backup_${TIMESTAMP}.custom"

echo "📦 Exporting database..."
echo "   This may take a few minutes depending on database size..."
echo ""

# Method 1: Plain SQL dump (recommended for small-medium databases)
echo "Creating SQL dump: $DUMP_FILE"
pg_dump "$DB_URL" > "$DUMP_FILE" 2>&1
DUMP_EXIT_CODE=$?

if [ $DUMP_EXIT_CODE -eq 0 ]; then
    FILE_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    echo "✅ SQL dump created successfully!"
    echo "   File: $DUMP_FILE"
    echo "   Size: $FILE_SIZE"
    echo ""
    
    # Also create a compressed version
    echo "Creating compressed version..."
    gzip -c "$DUMP_FILE" > "${DUMP_FILE}.gz"
    COMPRESSED_SIZE=$(du -h "${DUMP_FILE}.gz" | cut -f1)
    echo "✅ Compressed dump: ${DUMP_FILE}.gz ($COMPRESSED_SIZE)"
    echo ""
    
    echo "📋 Next Steps:"
    echo "=============="
    echo "1. Transfer the dump file to your Windows machine:"
    echo "   - Option A: Use SCP from Windows (PowerShell or WSL):"
    echo "     scp cipher@YOUR_VM_IP:/home/cipher/Apply\\ Bot/$DUMP_FILE ."
    echo ""
    echo "   - Option B: Use shared folder (if VM has shared folders enabled)"
    echo "   - Option C: Use SFTP client (FileZilla, WinSCP, etc.)"
    echo ""
    echo "2. On Windows, import the database:"
    echo "   - Install PostgreSQL on Windows (if not already installed)"
    echo "   - Open PowerShell/Command Prompt and run:"
    echo "     psql -U postgres -d jobbot < $DUMP_FILE"
    echo "   OR if using a custom format:"
    echo "     pg_restore -U postgres -d jobbot -v $DUMP_FILE_CUSTOM"
    echo ""
    echo "3. Update your Windows .env file with the new DATABASE_URL"
    echo ""
else
    echo "❌ ERROR: Failed to create dump file"
    exit 1
fi
