# BACKUP — Protecting your data

RentReceipt stores everything in two places:

1. The **SQLite database file** (tenants, payments, receipt numbers) — e.g.
   `/var/lib/rentreceipt/prod.db`.
2. The **receipt PDFs** — `server/storage/receipts/` (or the disk you symlinked
   it to).

Both must be backed up together so a restored database always has its matching
PDFs.

---

## Daily automated backup (VPS / Linux, cron)

### 1. Backup script

Save as `/usr/local/bin/rentreceipt-backup.sh` and make it executable
(`chmod +x`). Adjust the paths at the top to match your install.

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Configure these ---
DB_FILE="/var/lib/rentreceipt/prod.db"
RECEIPTS_DIR="/var/lib/rentreceipt/receipts"
BACKUP_ROOT="/var/backups/rentreceipt"   # second location (ideally another disk)
RETENTION_DAYS=30
# -----------------------

STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

# 1. Consistent SQLite copy (works even while the app is running).
sqlite3 "$DB_FILE" ".backup '$DEST/prod.db'"

# 2. Copy the receipt PDFs.
mkdir -p "$DEST/receipts"
cp -a "$RECEIPTS_DIR/." "$DEST/receipts/" 2>/dev/null || true

# 3. Compress into a single archive and remove the working folder.
tar -czf "$DEST.tar.gz" -C "$BACKUP_ROOT" "$STAMP"
rm -rf "$DEST"

# 4. Delete backups older than RETENTION_DAYS.
find "$BACKUP_ROOT" -name '*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "Backup complete: $DEST.tar.gz"
```

> `sqlite3 ".backup"` produces a **consistent** snapshot even while the server is
> running, which a plain `cp` of the DB file cannot guarantee. Install it with
> `sudo apt-get install -y sqlite3` if needed.

### 2. Schedule it with cron

Run daily at 02:15:

```bash
sudo crontab -e
```

Add:

```cron
15 2 * * * /usr/local/bin/rentreceipt-backup.sh >> /var/log/rentreceipt-backup.log 2>&1
```

### 3. Send a copy off the server (strongly recommended)

A backup on the same machine won't help if the machine dies. Copy the archive to
another location — pick one:

```bash
# Another server via rsync/ssh:
rsync -az "$DEST.tar.gz" backup-user@backup-host:/backups/rentreceipt/

# Or object storage (e.g. rclone to S3/B2/Google Drive):
rclone copy "$DEST.tar.gz" remote:rentreceipt-backups/
```

Add whichever line to the end of the backup script.

---

## Restore procedure (tested)

1. **Stop the app** so nothing writes during the restore:
   ```bash
   pm2 stop rentreceipt
   ```
2. **Pick the archive** to restore and unpack it somewhere temporary:
   ```bash
   mkdir -p /tmp/restore && tar -xzf /var/backups/rentreceipt/2026-07-18_021500.tar.gz -C /tmp/restore
   ls /tmp/restore/*/          # you should see prod.db and receipts/
   ```
3. **Restore the database** (back up the current one first, just in case):
   ```bash
   cp /var/lib/rentreceipt/prod.db /var/lib/rentreceipt/prod.db.pre-restore 2>/dev/null || true
   cp /tmp/restore/*/prod.db /var/lib/rentreceipt/prod.db
   ```
4. **Restore the receipts:**
   ```bash
   cp -a /tmp/restore/*/receipts/. /var/lib/rentreceipt/receipts/
   ```
5. **Fix ownership/permissions** so the app user can read/write:
   ```bash
   sudo chown -R $USER:$USER /var/lib/rentreceipt
   ```
6. **Start the app** and verify:
   ```bash
   pm2 start rentreceipt
   ```
   Log in, open a tenant, and click **Reprint** on an old receipt — the stored
   PDF should open. Check the dashboard totals look right.

### Verify your backups regularly

A backup you've never restored is a hope, not a backup. Every few months, restore
the latest archive onto a **test** machine (or a temporary folder with a separate
`DATABASE_URL`) and confirm the app starts and receipts open.

---

## Windows note

If you host on Windows instead of Linux, use **Task Scheduler** to run a
PowerShell equivalent daily: copy the `.db` file and the `receipts` folder into a
timestamped folder under a backup drive, then zip it with `Compress-Archive`. The
restore steps are the same — stop the app, copy the files back, restart.
