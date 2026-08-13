# Deployment Guide — ReZENwator on Ubuntu 24.04

This guide covers deploying the ReZENwator application on your own Ubuntu 24.04 server. The application consists of a single Node.js process that serves both the web dashboard and runs the background polling jobs (iCal + email) on a 30-minute schedule.

---

## Prerequisites

The following software must be installed on your server before proceeding.

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22.x LTS | Install via NodeSource |
| pnpm | 10.x | `npm install -g pnpm` |
| MySQL / TiDB | 8.x | Local or remote database |
| Git | Any | For cloning the repository |

---

## Step 1 — Clone and Transfer the Project

Clone the repository directly on your server or transfer the files:

```bash
git clone <your-repo-url> /opt/rezenwator
cd /opt/rezenwator
```

---

## Step 2 — Install Dependencies

```bash
pnpm install --frozen-lockfile
```

---

## Step 3 — Configure Environment Variables

Create a `.env` file in the project root:

```bash
nano /opt/rezenwator/.env
```

Paste and fill in the following:

```env
# Database
DATABASE_URL=mysql://user:password@host:3306/rental_manager

# Auth
JWT_SECRET=your-very-long-random-secret-here

# Gmail IMAP
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-app-specific-password

# Application
NODE_ENV=production
PORT=3000
```

> **Security note:** Restrict permissions on the `.env` file:
> ```bash
> chmod 600 /opt/rezenwator/.env
> ```

---

## Step 4 — Build the Application

```bash
pnpm build
```

This compiles the React frontend and bundles the Express server into the `dist/` directory.

---

## Step 5 — Create a systemd Service

Create a service file so the application starts automatically on boot and restarts on failure:

```bash
sudo nano /etc/systemd/system/rezenwator.service
```

Paste the following content:

```ini
[Unit]
Description=ReZENwator — Short-Term Rental Dashboard
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/rezenwator
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rezenwator
EnvironmentFile=/opt/rezenwator/.env

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable rezenwator
sudo systemctl start rezenwator
sudo systemctl status rezenwator
```

---

## Step 6 — (Optional) Nginx Reverse Proxy

If you want to expose the dashboard on port 80/443 with a domain name, install Nginx:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Create a site configuration:

```bash
sudo nano /etc/nginx/sites-available/rezenwator
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/rezenwator /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# Obtain SSL certificate:
sudo certbot --nginx -d your-domain.com
```

---

## Step 7 — (Alternative) Cron-Based Polling

If you prefer to run the polling jobs as standalone cron jobs instead of the built-in scheduler, you can disable the scheduler in `server/workers/scheduler.ts` and use cron:

```bash
crontab -e
```

Add:

```cron
# iCal sync every 30 minutes
*/30 * * * * cd /opt/rezenwator && node -e "import('./dist/workers/icalPoller.js').then(m => m.pollAllICalFeeds())" >> /var/log/rental-ical.log 2>&1

# Email check every 30 minutes (offset by 5 minutes)
5,35 * * * * cd /opt/rezenwator && node -e "import('./dist/workers/emailPoller.js').then(m => m.pollEmails())" >> /var/log/rental-email.log 2>&1
```

---

## Monitoring

View live application logs:

```bash
sudo journalctl -u rezenwator -f
```

View the last 100 lines:

```bash
sudo journalctl -u rezenwator -n 100
```

---

## Email Forwarding Setup (Hotmail → Gmail)

To forward relevant emails from your primary account to your configured `GMAIL_USER`:

1. In your primary email provider (e.g., Outlook), go to **Settings → Mail → Rules → Add new rule**
2. Create rules to forward emails from:
   - `noreply@slowhop.com` (or subject contains "Rezerwacja")
   - `automated@airbnb.com` (or subject contains "Reservation confirmed")
   - `noreply@nestbank.pl` (or subject contains "Wpływ na konto")
3. Set action: **Forward to** `your-email@gmail.com`

---

## Updating the Application

```bash
cd /opt/rezenwator
git pull  # or re-upload and unzip
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart rezenwator
```

---

## Database backups

The daily maintenance run (08:00) dumps the database to `backups/` with
`mysqldump` and keeps the ten most recent files. The password is passed through
`MYSQL_PWD` rather than the command line, where `ps` would show it to every user
on the machine.

### Off-site copy

Ten dumps on the same disk as the database they came from protect against a bad
query and nothing else — one disk failure takes the database and every backup of
it together. Set `BACKUP_REMOTE` in `.env` to an rclone remote and each dump is
copied there as well:

```
BACKUP_REMOTE=gdrive:rezenwator-backups
```

A failed copy sends an alert email. An off-site backup that has quietly stopped
working is indistinguishable from one that never ran, right up until the day it
is needed.

**Setting up the Google Drive remote.** rclone no longer accepts a blank client
ID for Drive, so it needs an OAuth client of its own. This installation reuses
the one from `task_manager` — same Google Cloud project, with the Drive API
enabled alongside Calendar. The client must be of type **Desktop**, and the
consent screen must be **published to production**: while it sits in *Testing*,
Google expires the refresh token after seven days and the copies stop without a
word.

On a headless machine the browser step needs a hand. `rclone config reconnect
gdrive:` prints a link to `http://127.0.0.1:53682/auth?state=…`, which only
resolves on the machine rclone runs on. Either forward the port
(`ssh -L 53682:localhost:53682 …`) and open the link locally, or fetch it on the
server with `curl -D -` to read the `Location` header, open *that* Google URL in
any browser, and feed the resulting `?code=…` redirect back with a second
`curl` to `http://127.0.0.1:53682/`. Use `rclone config reconnect`, not `rclone
authorize`: the first writes the token into `rclone.conf`, the second only
prints it.

Never pass the client secret on the command line — `ps` and shell history both
keep it.

### Running a backup on demand

Before a risky migration, or to check the off-site copy still works:

```bash
npx tsx scripts/run_backup_now.ts
```

Same code path as the nightly run, without the rest of the maintenance (which
sends mail to guests).
