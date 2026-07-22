# DEPLOYMENT — Production

RentReceipt is a **single-process** app in production: the Node/Express backend
serves both the API and the built React app on one port. This keeps hosting cheap
and simple.

You have two good options:

- **Option A — Low-cost VPS** (DigitalOcean, Hetzner, Linode): most control,
  ~$4–6/month, you manage the server. Recommended for full ownership of your
  SQLite file and receipt PDFs.
- **Option B — PaaS** (Railway or Render): least setup, but you must attach a
  **persistent disk** so the SQLite database and PDFs survive restarts.

---

## Build the frontend (both options)

The client is compiled to static files that the server serves:

```bash
npm install
npm run build          # outputs client/dist/
```

In production the server serves `client/dist` automatically when
`NODE_ENV=production`.

---

## Option A — VPS (Ubuntu) with pm2 + Nginx + HTTPS

### 1. Install Node + pm2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

### 2. Get the code + install

```bash
sudo mkdir -p /var/www/rentreceipt && cd /var/www/rentreceipt
# copy your project here (git clone or scp), then:
npm install
npm run build
```

### 3. Create a persistent data location

Keep the database and receipts **outside** the app folder so redeploys never wipe
them:

```bash
sudo mkdir -p /var/lib/rentreceipt/receipts
sudo chown -R $USER:$USER /var/lib/rentreceipt
```

Point the app at it — the receipts folder is `server/storage/receipts`; symlink
it (or set the DB path outside the repo):

```bash
# Database outside the repo:
#   DATABASE_URL="file:/var/lib/rentreceipt/prod.db"
# Persist receipts by symlinking the storage dir:
rm -rf server/storage/receipts
ln -s /var/lib/rentreceipt/receipts server/storage/receipts
```

### 4. Environment file

Create `server/.env` (see [.env.example](../.env.example)) with **production**
values:

```env
NODE_ENV=production
PORT=4000
DATABASE_URL="file:/var/lib/rentreceipt/prod.db"
JWT_SECRET="<paste output of: openssl rand -base64 48>"
LANDLORD_EMAIL="you@example.com"
LANDLORD_PASSWORD="<a strong password — change after first login>"
# SMTP_* — see docs/EMAIL_SETUP.md
```

### 5. Migrate + seed (first deploy only)

```bash
npm run db:migrate --workspace server   # applies migrations (prisma migrate deploy)
npm run db:seed --workspace server      # creates landlord + 24 rooms
```

> On later deploys run only `db:migrate` — **never** `db:reset` in production
> (it deletes data).

### 6. Start with pm2

```bash
pm2 start server/src/index.js --name rentreceipt --update-env
pm2 save
pm2 startup      # follow the printed command so it restarts on reboot
```

The app is now on `http://<server-ip>:4000`.

### 7. Nginx reverse proxy

`/etc/nginx/sites-available/rentreceipt`:

```nginx
server {
    listen 80;
    server_name rent.yourdomain.com;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/rentreceipt /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 8. HTTPS with Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d rent.yourdomain.com
```

Certbot edits your Nginx config for HTTPS and sets up auto-renewal. Because the
session cookie is `secure` in production, **you must serve over HTTPS** for login
to work.

### 9. Deploying updates

```bash
cd /var/www/rentreceipt
git pull                 # or re-copy files
npm install
npm run build
npm run db:migrate --workspace server
pm2 restart rentreceipt --update-env
```

---

## Option B — Railway or Render (PaaS)

Both build from your repo and run one web service.

### Settings

- **Build command:** `npm install && npm run build`
- **Start command:** `npm run db:migrate --workspace server && npm start`
- **Persistent disk (required):** mount a volume and put the database + receipts
  on it, e.g. mount at `/data`, then set:
  - `DATABASE_URL=file:/data/prod.db`
  - symlink receipts to the disk, or mount the volume at
    `server/storage/receipts`.
- **Environment variables:** set everything from `.env.example`
  (`NODE_ENV=production`, `JWT_SECRET`, `LANDLORD_EMAIL`, `LANDLORD_PASSWORD`,
  `SMTP_*`). Railway/Render provide `PORT` automatically — the app reads it.

### First deploy

The start command runs `prisma migrate deploy` on every boot (safe/idempotent).
To create the landlord + 24 rooms once, run a one-off command in the platform
shell:

```bash
npm run db:seed --workspace server
```

> ⚠️ Without a persistent disk, PaaS filesystems are ephemeral — your database
> and PDFs would be lost on every redeploy. Always attach a volume.

---

## Production checklist

- [ ] `NODE_ENV=production`
- [ ] Strong, unique `JWT_SECRET`
- [ ] Changed the landlord password after first login
- [ ] HTTPS working (required for the secure login cookie)
- [ ] Database + `receipts/` on persistent storage
- [ ] Automated backups configured — see [BACKUP.md](./BACKUP.md)
- [ ] Email tested from Settings → "Send test email"
