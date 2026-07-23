# BACKUP — Protecting your data

RentReceipt stores **everything in the MySQL database** — tenants, payments, receipt
numbers, **and the receipt PDFs** (kept as bytes in the DB). So a single database
backup captures all your data; there are no separate files to copy.

You have two complementary options:

- **Managed provider backups** (easiest): Railway, Aiven, PlanetScale, RDS, etc. all
  offer automated daily backups / point-in-time restore. **Turn these on** — it's the
  simplest safety net. Check your provider's dashboard for "Backups".
- **Your own `mysqldump`** (portable, provider-independent): a daily dump you control
  and can store anywhere. Covered below.

---

## Daily automated backup with `mysqldump` (cron)

### 1. Backup script

Save as `/usr/local/bin/rentreceipt-backup.sh`, make it executable (`chmod +x`), and
set your database connection details at the top.

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Configure these (from your DATABASE_URL) ---
DB_HOST="host"
DB_PORT="3306"
DB_USER="user"
DB_PASS="password"
DB_NAME="railway"
BACKUP_ROOT="/var/backups/rentreceipt"
RETENTION_DAYS=30
# ------------------------------------------------

STAMP="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$BACKUP_ROOT"

# Single-transaction dump = consistent snapshot without locking the app out.
# --hex-blob keeps the receipt PDF bytes safe in the SQL dump.
mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password="$DB_PASS" \
  --single-transaction --quick --hex-blob --routines "$DB_NAME" \
  | gzip > "$BACKUP_ROOT/$DB_NAME-$STAMP.sql.gz"

# Delete backups older than RETENTION_DAYS.
find "$BACKUP_ROOT" -name '*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "Backup complete: $BACKUP_ROOT/$DB_NAME-$STAMP.sql.gz"
```

> Install the MySQL client tools if needed: `sudo apt-get install -y default-mysql-client`.
> The single `.sql.gz` file already contains the PDFs — nothing else to back up.

### 2. Schedule it with cron

Run daily at 02:15:

```bash
crontab -e
```

Add:

```cron
15 2 * * * /usr/local/bin/rentreceipt-backup.sh >> /var/log/rentreceipt-backup.log 2>&1
```

### 3. Send a copy off-site (strongly recommended)

A backup next to the database won't help if that machine/account is lost. Copy the
dump somewhere else — add one of these to the end of the script:

```bash
# Object storage (e.g. rclone to S3 / Backblaze B2 / Google Drive):
rclone copy "$BACKUP_ROOT/$DB_NAME-$STAMP.sql.gz" remote:rentreceipt-backups/

# Or another server via ssh:
rsync -az "$BACKUP_ROOT/$DB_NAME-$STAMP.sql.gz" backup-user@backup-host:/backups/
```

---

## Restore procedure (tested)

1. Have the target database ready (an empty database, or your existing one you intend
   to overwrite).
2. Decompress and import the dump:
   ```bash
   gunzip -c /var/backups/rentreceipt/railway-2026-07-23_021500.sql.gz \
     | mysql --host="HOST" --port=3306 --user="USER" --password="PASS" "DB_NAME"
   ```
3. Start the app pointed at that database and **verify**: log in, open a tenant, and
   click **Reprint** on an old receipt — the stored PDF should open (proving the PDF
   bytes restored). Check the dashboard totals look right.

> Restoring into a **fresh** database is cleanest. To overwrite an existing one,
> either drop/recreate it first or trust the dump's `DROP TABLE ... CREATE TABLE`
> statements (mysqldump includes them by default).

### Verify your backups regularly

A backup you've never restored is a hope, not a backup. Every few months, restore the
latest dump into a **throwaway** database and confirm the app starts and receipts
open.

---

## Windows note

`mysqldump` / `mysql` ship with MySQL and MySQL Workbench on Windows too. Use **Task
Scheduler** to run the same `mysqldump ... | gzip` command daily (via Git Bash or a
PowerShell equivalent using `Compress-Archive`). Restore is the same `mysql < dump`
import.
