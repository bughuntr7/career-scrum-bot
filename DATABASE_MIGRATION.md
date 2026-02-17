# Database Migration Guide: Ubuntu VM → Windows Host

This guide helps you move your PostgreSQL database from the Ubuntu VM to your Windows host.

## Step 1: Export Database from Ubuntu VM

### Option A: Use the Export Script (Recommended)

```bash
cd "/home/cipher/Apply Bot"
./scripts/exportDatabase.sh
```

This will create:
- `jobbot_backup_YYYYMMDD_HHMMSS.sql` - SQL dump file
- `jobbot_backup_YYYYMMDD_HHMMSS.sql.gz` - Compressed version (smaller)

### Option B: Manual Export

```bash
# Extract database name from .env
cd "/home/cipher/Apply Bot"
source .env 2>/dev/null || true

# Export database (replace with your actual DATABASE_URL)
pg_dump "postgresql://jobbot:PASSWORD@localhost:5432/jobbot" > jobbot_backup.sql

# Or create compressed version
pg_dump "postgresql://jobbot:PASSWORD@localhost:5432/jobbot" | gzip > jobbot_backup.sql.gz
```

## Step 2: Transfer File to Windows

### Option A: SCP (from Windows PowerShell or WSL)

```powershell
# In Windows PowerShell or WSL
scp cipher@YOUR_VM_IP:"/home/cipher/Apply Bot/jobbot_backup_*.sql" C:\Users\YourUsername\Downloads\
```

### Option B: Shared Folder (VMware/VirtualBox)

1. Enable shared folders in your VM settings
2. Copy the `.sql` file to the shared folder
3. Access it from Windows Explorer

### Option C: SFTP Client (FileZilla, WinSCP)

1. Connect to your VM via SFTP
2. Navigate to `/home/cipher/Apply Bot/`
3. Download the `jobbot_backup_*.sql` file

### Option D: Cloud Storage

Upload to Google Drive, Dropbox, OneDrive, etc., then download on Windows.

## Step 3: Set Up PostgreSQL on Windows

### Install PostgreSQL (if not already installed)

1. Download PostgreSQL from: https://www.postgresql.org/download/windows/
2. Run the installer
3. Remember the password you set for the `postgres` user
4. Note the port (default: 5432)

### Create Database on Windows

```powershell
# Open PowerShell as Administrator
# Connect to PostgreSQL
psql -U postgres

# Create database and user (in psql prompt)
CREATE DATABASE jobbot;
CREATE USER jobbot WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE jobbot TO jobbot;
\q
```

## Step 4: Import Database on Windows

### Method 1: Using psql (Plain SQL dump)

```powershell
# Navigate to where you saved the dump file
cd C:\Users\YourUsername\Downloads

# Import the database
psql -U postgres -d jobbot -f jobbot_backup_YYYYMMDD_HHMMSS.sql

# Or if you downloaded the compressed version, decompress first
# (Use 7-Zip or similar to extract .gz file)
```

### Method 2: Using pgAdmin (GUI)

1. Open pgAdmin
2. Right-click on `jobbot` database → **Restore**
3. Select your `.sql` dump file
4. Click **Restore**

## Step 5: Update Application Configuration

### Update .env on Windows

Create or update `.env` file in your Windows project directory:

```env
DATABASE_URL="postgresql://jobbot:your_password@localhost:5432/jobbot"
```

### Run Prisma Migrations (if needed)

```powershell
cd "C:\path\to\Apply Bot"
npm install
npx prisma generate
npx prisma db push  # Or npx prisma migrate deploy if you have migrations
```

## Step 6: Verify Migration

```powershell
# Test database connection
npx prisma studio
# Or run your app and check if data is there
npm run dev
```

## Troubleshooting

### "psql: command not found" on Windows
- Add PostgreSQL bin directory to PATH:
  - Usually: `C:\Program Files\PostgreSQL\XX\bin`
  - Or use full path: `"C:\Program Files\PostgreSQL\XX\bin\psql.exe"`

### "Permission denied" errors
- Make sure the `jobbot` user has proper permissions
- Try importing as `postgres` superuser first

### Connection errors
- Check PostgreSQL service is running: `services.msc` → PostgreSQL
- Verify firewall allows port 5432
- Check `pg_hba.conf` for authentication settings

### Large database issues
- Use compressed dump (`.sql.gz`) to reduce transfer time
- Consider using `pg_dump` with `-Fc` format for faster restore:
  ```bash
  pg_dump -Fc "postgresql://..." > jobbot_backup.custom
  ```
  Then restore with:
  ```powershell
  pg_restore -U postgres -d jobbot -v jobbot_backup.custom
  ```

## Quick Reference

**Ubuntu Export:**
```bash
./scripts/exportDatabase.sh
```

**Windows Import:**
```powershell
psql -U postgres -d jobbot -f jobbot_backup.sql
```

**Update .env:**
```env
DATABASE_URL="postgresql://jobbot:password@localhost:5432/jobbot"
```
