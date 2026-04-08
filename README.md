# Rental Manager 1.0

A comprehensive, fully functional management suite for short-term rental properties. This project consists of a high-performance **Admin Dashboard** for hosts and a modern, localized **Guest Portal** for property discovery and booking.

## 🚀 Features

### Admin Dashboard
*   **Unified Calendar**: Visualizes bookings from all channels (Slowhop, Airbnb, Booking.com, Alohacamp).
*   **Operational Views**:
    *   **Bookings**: Table view with advanced filtering, status tracking, and revenue data.
    *   **Cleaning View**: Specialized interface for managing turnovers and property maintenance.
    *   **Operations**: Real-time health monitoring of background jobs (iCal sync, Email polling).
*   **Financial Management**: Automatic matching of bank transfers to bookings, revenue statistics, and pricing plan configuration.
*   **Automated Communication**: Automatic sending of rental contracts (PDF), arrival reminders, and stay-finished follow-ups via Gmail.

### Guest Portal
*   **Property Showcase**: Dedicated pages for properties (e.g., Sadoles, Hacjenda) with high-quality galleries.
*   **Multi-language Support**: Full support for Polish and English content.
*   **Booking Widget**: Integrated widget for guests to request stays directly.
*   **Automated Reviews**: Scrapes and displays ratings from external platforms to build trust.

### Technical Excellence
*   **Background Workers**: Intelligent polling for iCal feeds and Email notifications with automated deduplication and status updates.
*   **Robust Parsing**: Advanced regex-based parsing for booking confirmation emails and bank transfer notifications.
*   **Secure Configuration**: Zero hardcoded personal information; all business and property data is managed via environment variables.

---

## 🛠 Tech Stack

*   **Frontend**: React 19, TypeScript, Tailwind CSS, Radix UI, Vite.
*   **Backend**: Node.js (Express), tRPC for type-safe API, Drizzle ORM.
*   **Database**: MySQL / TiDB.
*   **Tools**: Vitest (Testing), esbuild (Bundling), date-fns, jsPDF.

---

## 📦 Deployment

The application is designed to run as a single Node.js process on an Ubuntu 24.04+ server.

### 1. Prerequisites
*   Node.js 22.x LTS
*   pnpm 10.x
*   MySQL 8.x or TiDB

### 2. Installation
```bash
git clone <your-repo-url>
cd rental-manager
pnpm install --frozen-lockfile
```

### 3. Environment Setup
Create a `.env` file in the root directory. Refer to `DEPLOYMENT.md` for a complete list of required variables. Key categories include:
*   `DATABASE_URL`: Connection string for MySQL.
*   `JWT_SECRET`: Secret for session management.
*   `GMAIL_USER` & `GMAIL_APP_PASSWORD`: Credentials for automated emails.
*   `ICAL_*`: Feed URLs for property synchronization.
*   `BUSINESS_*` & `BANK_*`: Your business registration and payment details.

### 4. Build & Run
```bash
# Build both Portal and Admin apps
pnpm build

# Start the production server
pnpm start
```

---

## 🧪 Testing
The project includes a suite of automated tests for email parsing and logic verification.
```bash
pnpm test
```

## 📄 License
This project is licensed under the MIT License.
