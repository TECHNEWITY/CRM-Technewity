# Technewity Labs — Enterprise CRM & Project Management System

**Technewity Labs CRM & Project Management System** is an enterprise-grade, high-performance workspace platform built for modern development teams, agencies, and growing organizations. It combines project tracking, team collaboration, task automation, custom analytics, and real-time video meetings into a unified interface.

Official Website: [https://technewity.com](https://technewity.com)

---

## ✨ Features Overview

- **🏢 Multi-Tenant Organizations & Team Management**: Granular member role permissions (Admin, Manager, Member, Guest), team invitations, and organization switching.
- **📋 Dynamic Project Views**:
  - **Kanban Board View**: Drag-and-drop task boards with custom status columns.
  - **List & Grid Views**: Structured data views with customizable columns.
  - **Calendar View**: Visual scheduling across days and months.
  - **Timeline & Vision View**: Strategic roadmap tracking for long-term goals.
  - **Analytics Dashboard**: Custom metrics, charts, and progress summaries.
- **⚡ Task Automation & Scheduler**: Event-driven triggers and cron-like automated task workflows.
- **📹 Live Video Meetings**: Built-in online room collaboration powered by LiveKit.
- **💬 Real-Time Collaboration**: Instant comment updates and notifications powered by Pusher channels.
- **🔐 Multi-Factor Authentication & Google OAuth**: Firebase-powered Google Sign-In and secure JWT token-based authentication.
- **📧 Transactional Email System**: Account activation and password reset emails via Resend.

---

## 🛠️ Tech Stack & Architecture

- **Frontend**: Next.js (App Router), React 18, TailwindCSS, Framer Motion, Radix UI.
- **Monorepo Architecture**: NX Workspace structure.
- **Backend API**: Node.js, Express, Prisma ORM (v5.2.0).
- **Database**: MongoDB Atlas (Cloud) / Local MongoDB Replica Set.
- **Cache & Message Broker**: Upstash Redis (Cloud) / Local Redis Server.
- **Authentication**: Firebase Authentication (Google OAuth) + JWT Refresh Tokens.
- **Email Service**: Resend.com.

---

## 🚀 Quick Start & Local Setup

### 1. Prerequisites
Ensure you have the following installed on your local machine:
- **Node.js**: v18.x or v22.x
- **Yarn**: `npm install -g yarn`

### 2. Installation
Clone the repository and install all workspace dependencies:
```bash
# Install all workspace packages
$ yarn install

# Generate Prisma Client (Schema v5.2.0)
$ yarn generate2

# Synchronize Database Collections & Indexes
$ yarn pushdb2

# Seed Default Database Data
$ yarn seed2

# Compile All Applications
$ yarn build:all
```

### 3. Running Local Development
Start the local database & cache services, backend API, and Next.js frontend:
```bash
# Terminal 1: Backend API (Port 3333)
$ yarn backend

# Terminal 2: Next.js Frontend (Port 4200)
$ yarn frontend
```

Open [http://localhost:4200](http://localhost:4200) in your browser.

---

## ⚙️ Environment Configuration (`.env` / `.env.local`)

Below are the key environment variables required for running the application:

```env
# Application Settings
DEV_MODE=0
NEXT_PUBLIC_APP_NAME=Technewity Labs
NEXT_PUBLIC_FE_GATEWAY=http://localhost:4200/
NEXT_PUBLIC_BE_GATEWAY=http://localhost:3333/
NEXT_PUBLIC_DISABLE_REGISTRATION=0

# Database & Cache
MONGODB_URL=mongodb+srv://<user>:<password>@cluster.mongodb.net/technewity?retryWrites=true&w=majority
REDIS_HOST=rediss://<user>:<pass>@shining-anchovy-172866.upstash.io:6379

# Authentication Secrets (Generate 48-byte random strings)
JWT_SECRET_KEY=your_secure_jwt_secret_key_here
JWT_REFRESH_KEY=your_secure_jwt_refresh_key_here
JWT_TOKEN_EXPIRED=30m
JWT_REFRESH_EXPIRED=4h

# Google Auth (Firebase Config)
NEXT_PUBLIC_FIREBASE_CLIENT_CONFIG={"apiKey":"YOUR_KEY","authDomain":"YOUR_DOMAIN","projectId":"YOUR_ID",...}

# Email Notifications (Resend)
RESEND_TOKEN=re_MG1yRhjH_...
RESEND_EMAIL_DOMAIN=technewity.com
RESEND_EMAIL_NAME=Technewity Labs
```

---

## 📦 Production Deployment Guide

### Deploying Backend & Frontend
1. Set all production environment variables in your deployment dashboard (e.g. Render, Vercel, Railway, AWS).
2. Execute `yarn generate2` and `yarn pushdb2` to synchronize your production MongoDB Atlas cluster.
3. Build the applications:
   - Backend: `yarn build:be` -> Start command: `node ./dist/apps/backend/main.js`
   - Frontend: `yarn build:fe` -> Start command: `npx next start ./dist/apps/frontend/ -p 4200`
4. Add your production domain in **MongoDB Atlas Network Access** (`0.0.0.0/0`) and **Firebase Console Authorized Domains**.

---

## 📄 License & Credits

Maintained and developed by **Technewity Labs**.  
Website: [https://technewity.com](https://technewity.com)  
Contact: [contact@technewity.com](mailto:contact@technewity.com)





