# Deployment Guide — Rental Manager on Ubuntu 24.04

This guide covers deploying the Rental Manager application on your own Ubuntu 24.04 server. The application consists of a single Node.js process that serves both the web dashboard and runs the background polling jobs (iCal + email) on a 30-minute schedule.

---

## Prerequisites

The following software must be installed on your server before proceeding.

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22.x LTS | Install via NodeSource |
| pnpm | 10.x | `npm install -g pnpm` |
| MySQL / TiDB | 8.x | Or use the hosted DB from your Manus project |
| Git | Any | For cloning the repository |

---

## Step 1 — Export and Transfer the Project

In the Manus Management UI, navigate to **Code → Download all files** to get a ZIP of the project. Transfer it to your server:

```bash
scp rental-manager.zip user@your-server:/opt/
ssh user@your-server
cd /opt && unzip rental-manager.zip
mv rental-manager /opt/rental-manager
```

---

## Step 2 — Install Dependencies

```bash
cd /opt/rental-manager
pnpm install --frozen-lockfile
```

---

## Step 3 — Configure Environment Variables

Create a `.env` file in the project root:

```bash
nano /opt/rental-manager/.env
```

Paste and fill in the following:

```env
# Database — use the connection string from your Manus project dashboard
DATABASE_URL=mysql://user:password@host:3306/rental_manager

# Auth
JWT_SECRET=your-very-long-random-secret-here

# Gmail IMAP
GMAIL_USER=furtka.rentals@gmail.com
GMAIL_APP_PASSWORD=xenf rxhm ntzb zwys

# Application
NODE_ENV=production
PORT=3000
```

> **Security note:** Restrict permissions on the `.env` file:
> ```bash
> chmod 600 /opt/rental-manager/.env
> ```

---

## Step 4 — Build the Application

```bash
cd /opt/rental-manager
pnpm build
```

This compiles the React frontend and bundles the Express server into the `dist/` directory.

---

## Step 5 — Create a systemd Service

Create a service file so the application starts automatically on boot and restarts on failure:

```bash
sudo nano /etc/systemd/system/rental-manager.service
```

Paste the following content:

```ini
[Unit]
Description=Rental Manager — Short-Term Rental Dashboard
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/rental-manager
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rental-manager
EnvironmentFile=/opt/rental-manager/.env

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable rental-manager
sudo systemctl start rental-manager
sudo systemctl status rental-manager
```

---

## Step 6 — (Optional) Nginx Reverse Proxy

If you want to expose the dashboard on port 80/443 with a domain name, install Nginx:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Create a site configuration:

```bash
sudo nano /etc/nginx/sites-available/rental-manager
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
sudo ln -s /etc/nginx/sites-available/rental-manager /etc/nginx/sites-enabled/
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
*/30 * * * * cd /opt/rental-manager && node -e "import('./dist/workers/icalPoller.js').then(m => m.pollAllICalFeeds())" >> /var/log/rental-ical.log 2>&1

# Email check every 30 minutes (offset by 5 minutes)
5,35 * * * * cd /opt/rental-manager && node -e "import('./dist/workers/emailPoller.js').then(m => m.pollEmails())" >> /var/log/rental-email.log 2>&1
```

---

## Monitoring

View live application logs:

```bash
sudo journalctl -u rental-manager -f
```

View the last 100 lines:

```bash
sudo journalctl -u rental-manager -n 100
```

---

## Email Forwarding Setup (Hotmail → Gmail)

To forward relevant emails from your Hotmail/Outlook account to `furtka.rentals@gmail.com`:

1. In Outlook Web, go to **Settings → Mail → Rules → Add new rule**
2. Create rules to forward emails from:
   - `noreply@slowhop.com` (or subject contains "Rezerwacja")
   - `automated@airbnb.com` (or subject contains "Reservation confirmed")
   - `noreply@nestbank.pl` (or subject contains "Wpływ na konto")
3. Set action: **Forward to** `furtka.rentals@gmail.com`

---

## Updating the Application

```bash
cd /opt/rental-manager
git pull  # or re-upload and unzip
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart rental-manager
```
