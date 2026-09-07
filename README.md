# AIRTEC — School ERP MVP

Full-stack School ERP built with Node.js + TypeScript + Supabase + Next.js.

## Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: Supabase (PostgreSQL)
- **Frontend**: Next.js 14 + Tailwind CSS + React Query
- **Auth**: Supabase Auth (JWT)

## Phase 1 Modules

- ✅ **SIS** — Student profiles, class/section, bulk ops, house management, TC, promotions
- ✅ **Admission CRM** — Inquiry pipeline, follow-ups, approval workflow
- ✅ **Fee Management** — Structures, invoices, payments, dues, discounts
- ✅ **Auth + RBAC** — Multi-role: admin, principal, counselor, accountant, teacher

---

## Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name: `airtec`, Region: `ap-south-1` (Mumbai)
3. Copy your project URL and keys from Settings → API

### 2. Run Database Migration

Option A — Supabase CLI:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_ID
supabase db push
```

Option B — Paste directly in Supabase SQL Editor:
- Go to your project → SQL Editor
- Paste the contents of `supabase/migrations/001_core_schema.sql`
- Click Run

### 3. Backend Setup

```bash
cd backend
cp .env.example .env
# Fill in your Supabase URL and keys in .env
npm install
npm run dev
```

Backend runs on `http://localhost:4000`

### 4. Frontend Setup

```bash
cd frontend
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`

### 5. Register Your School

Hit `POST /api/auth/register-school`:
```json
{
  "school_name": "Demo School",
  "school_city": "Lucknow",
  "school_state": "UP",
  "full_name": "Admin User",
  "email": "admin@demo.com",
  "password": "Admin@1234"
}
```

This creates the school + admin user + seeds default data (classes 1–12, 4 houses, default fee heads).

---

## Deployment (Dokploy / Docker Compose)

`docker-compose.yml` is the single deployment definition — three services:
the backend API, the staff admin app, and the parent/student family portal.
Both web apps proxy `/api/*` to the backend over the internal Docker network,
so the backend needs no public domain and there is no CORS to configure.

### Local

```bash
cp .env.example .env      # fill in Supabase keys at minimum
docker compose up --build
```

- staff  → `http://localhost:${WEB_HOST_PORT:-3010}`
- portal → `http://localhost:${PORTAL_HOST_PORT:-3011}`

Host ports are loopback-bound and default to 3010/3011/4010 rather than
3000/3001/4000, so they don't collide with another app on a shared host. If
the port you pick is already taken the container fails to start with
`port is already allocated`.

### Dokploy

1. Create a **Compose** application pointing at this repo.
2. Paste the variables from `.env.example` into the **Environment** tab.
3. Assign a domain to **each** web app, targeting its container port:
   - staff admin → `frontend`, container port `3000`
   - family portal → `portal`, container port `3001`

The public domain is independent of the host ports above: Traefik routes the
domain straight to the container port.

> **Adding a new environment variable takes two edits, not one.** Compose
> passes into a container only what that service's `environment:` block names.
> A variable set in Dokploy's Environment tab but missing from
> `docker-compose.yml` arrives as `undefined`, and the failure is usually
> silent — this is exactly how OneSignal push was dead in production for two
> days while the app reported push as working. Add every new variable to the
> `environment:` block **and** to `.env.example`.

Anything baked in at *build* time (`NEXT_PUBLIC_*`, `BACKEND_URL`) is passed
as a compose `build.args` entry instead, and changing it needs a rebuild, not
just a restart.

### Crons

Every scheduled job is in-process (`cron.schedule` in `backend/src/index.ts`):
the delivery outbox every minute, fee reminders at 07:00 IST, HR alerts and the
timetable sweeps at 08:00. The backend container runs with
`restart: unless-stopped`, so it stays up and they keep their schedule — that
is a deployment requirement, not an incidental detail. On a host that spins the
service down when idle, none of them fire, and the authenticated
`POST /api/notifications/run-deliveries` and `run-fee-reminders` endpoints exist
as the fallback for that case.

---

## API Reference

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/register-school` | Onboard new school |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Refresh token |
| GET  | `/api/auth/me` | Current user profile |
| POST | `/api/auth/invite-user` | Invite staff |

### Students (SIS)
| Method | Route | Description |
|--------|-------|-------------|
| GET  | `/api/students` | List with filters |
| POST | `/api/students` | Create student |
| GET  | `/api/students/stats/dashboard` | Stats |
| GET  | `/api/students/:id` | Student profile |
| PATCH | `/api/students/:id` | Update student |
| POST | `/api/students/bulk/promote` | Bulk promote |
| POST | `/api/students/:id/tc` | Issue TC |

### Admission CRM
| Method | Route | Description |
|--------|-------|-------------|
| GET  | `/api/admission/inquiries` | List inquiries |
| POST | `/api/admission/inquiries` | Create inquiry |
| PATCH | `/api/admission/inquiries/:id` | Update inquiry/status |
| POST | `/api/admission/inquiries/:id/follow-ups` | Add follow-up |
| GET  | `/api/admission/inquiries/stats` | Pipeline stats |
| GET  | `/api/admission/applications` | Applications |
| POST | `/api/admission/applications` | Create application |
| POST | `/api/admission/applications/:id/approve` | Approve/reject |

### Fee Module
| Method | Route | Description |
|--------|-------|-------------|
| GET  | `/api/fees/heads` | Fee heads |
| POST | `/api/fees/heads` | Create fee head |
| GET  | `/api/fees/structures` | Fee structures |
| POST | `/api/fees/structures` | Create structure |
| POST | `/api/fees/invoices` | Generate invoice |
| POST | `/api/fees/payments` | Record payment |
| GET  | `/api/fees/dues` | Pending dues list |
| GET  | `/api/fees/stats` | Financial summary |
| POST | `/api/fees/discounts` | Grant discount |

---

## Project Structure

```
airtec/
├── backend/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/routes.ts       # Login, register, invite
│   │   │   ├── sis/routes.ts        # Student management
│   │   │   ├── admission/routes.ts  # CRM & applications
│   │   │   └── fee/routes.ts        # Fee collection
│   │   ├── shared/
│   │   │   ├── db/client.ts         # Supabase client
│   │   │   ├── middleware/auth.ts   # JWT + RBAC
│   │   │   ├── types/index.ts       # TypeScript types
│   │   │   └── utils/helpers.ts     # Error handling, pagination
│   │   └── index.ts                 # Express server
├── frontend/
│   ├── app/
│   │   ├── dashboard/page.tsx       # Main dashboard
│   │   ├── students/page.tsx        # Student list
│   │   ├── admission/page.tsx       # CRM
│   │   ├── fees/page.tsx            # Fee management
│   │   └── auth/login/page.tsx      # Login
│   ├── components/
│   │   └── layout/Sidebar.tsx
│   └── lib/
│       ├── api.ts                   # Typed API client
│       ├── auth.tsx                 # Auth context
│       └── utils.ts                 # Helpers
└── supabase/
    └── migrations/001_core_schema.sql
```

## Phase 2 Roadmap

- Exam / Result Management System (EMS)
- Certificate generation with QR verification
- ID Card bulk PDF generation
- Website CMS builder
- Staff HRMS module
- Parent/student self-service portal
