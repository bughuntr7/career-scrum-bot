## Job Application Bot

Personal job-application assistant that scans your Jobright **Recommended** board, saves jobs to a Postgres database, and auto-generates **tailored resumes** and **cover letters** using your styled `.docx` templates.

### Tech Stack

- **Frontend / Backend**: Next.js (App Router) + React + TypeScript  
- **Automation**: Playwright (Node) with persistent Jobright session  
- **Database**: PostgreSQL + Prisma  
- **LLM**: OpenAI API (tailored resume + story-like cover letter)  
- **Documents**: `.docx` generation via Docxtemplater + Mammoth

---

## Features

- **Jobright scan**
  - Uses your logged-in Jobright Recommended page (Google login done once via Playwright helper).
  - Clicks **Apply / Apply with Autofill / Apply Now**, follows to company site.
  - Captures external apply URL and full job description (when extractable).
  - Skips:
    - LinkedIn URLs  
    - Duplicate jobs (same title + company)  
    - Jobs with match score below **80%** (configurable).
- **Database & UI**
  - Stores: date, title, company, site URL, Jobright match score, job description.
  - Next.js `/jobs` page with:
    - Editable table (edit/delete rows).
    - Filters: date range, has/has-not description.
    - CSV export of filtered rows.
    - **Scan Jobs** button to trigger Playwright scan from the UI.
    - **Docs** status pills per job:
      - Resume / Cover / Desc (description) present or not.
- **Resume & cover letter generation**
  - Uses your templates in `Resumes/Templates`:
    - `Jiayong Lin_Sample.docx` – full base resume text.
    - `Jiayong Lin.docx` – styled resume template with placeholders.
    - `Cover Letter.docx` – styled cover letter template with `{coverletterContent}`.
  - LLM prompt:
    - Keeps name, company names, dates, high-level role titles.
    - Keeps EDUCATION unchanged.
    - Heavily tailors technologies & skills per job description.
  - Generates:
    - Tailored resume `.docx` (`Resumes/<Company+Role>/Jiayong Lin.docx`).
    - Cover letter `.docx` (`Resumes/<Company+Role>/Cover Letter.docx`).
    - Text copy of job description.
  - Saves raw LLM outputs into `tailored_resumes` and `cover_letters` tables and marks job as `READY_TO_APPLY`.

---

## Prerequisites

- Node.js 18+  
- PostgreSQL instance  
- Git (optional, for version control)

---

## Setup

### 1. Install dependencies

```bash
cd "/home/cipher/Apply Bot"   # or your clone path
npm install
```

### 2. Configure environment

Create `.env` (this file is git-ignored):

```bash
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DATABASE
OPENAI_API_KEY=sk-...

# Playwright persistent context for Jobright (directory where cookies are stored)
JOBRIGHT_CONTEXT_DIR=/home/your-user/.jobbot/jobright

# Scanner options
JOBBOT_USER_ID=1
MAX_JOBS=5
AUTO_GENERATE_DOCUMENTS=true        # default; set "false" to disable
MATCH_SCORE_THRESHOLD=80            # minimum Jobright match score to process

# Optional
OPENAI_MODEL=gpt-4
RESUMES_OUTPUT_DIR=Resumes
```

### 3. Run Prisma migrations

```bash
npx prisma migrate dev
```

Ensure your Postgres user can create the shadow database (e.g., `ALTER ROLE jobbot CREATEDB;` if needed).

### 4. Prepare resume templates

- Place these files under `Resumes/Templates`:
  - `Jiayong Lin_Sample.docx` – full base resume content (all sections).
  - `Jiayong Lin.docx` – styled resume template with placeholders (used by Docxtemplater).
  - `Cover Letter.docx` – styled cover letter template with a body placeholder:

    ```text
    Hi Hiring Team,

    {coverletterContent}

    Best,
    Jiayong Lin
    ```

---

## Running the App

### 1. Start Next.js dev server

```bash
npm run dev
```

Visit `http://localhost:3000/jobs` to see the job table and controls.

### 2. Log in to Jobright once (persistent context)

```bash
JOBRIGHT_CONTEXT_DIR=/home/your-user/.jobbot/jobright npm run jobright:login
```

A Playwright browser opens; log in with Google and ensure you see the **Recommended** page. Close when done; cookies are stored for reuse.

### 3. Scan jobs

**From CLI:**

```bash
JOBRIGHT_CONTEXT_DIR=/home/your-user/.jobbot/jobright npm run jobright:scan
```

**From UI:**

- Open `/jobs` in the browser.  
- Click **Scan Jobs** (top right).  
- The scan runs in a child process via `/api/scan`.

Behavior per job:

- If match score `< MATCH_SCORE_THRESHOLD` → skip.  
- If apply URL is LinkedIn → skip.  
- Otherwise:
  - Save `job_applications` row.
  - Try to extract description and save `job_descriptions` row.
  - If `AUTO_GENERATE_DOCUMENTS` is enabled and description is substantial:
    - Generate tailored resume + cover letter.
    - Save `.docx` files under `Resumes/<Company+Role>/`.
    - Insert corresponding DB records and update status.

---

## UI Overview (`/jobs`)

- **Filters**
  - **Filter by Date**: All time / Today / Last 7 days / Last 30 days.
  - **Filter by Description**: All jobs / With description / Without description.
- **Docs column**
  - **Resume** pill: green if at least one tailored resume exists for the job.
  - **Cover** pill: blue if at least one cover letter exists.
  - **Desc** pill: purple if job description exists.
- **Actions**
  - **View Description** – opens modal with full scraped job description.
  - **Edit** – inline editing of title, company, site URL.
  - **Delete** – remove job from DB.
- **Export to CSV**
  - Exports currently filtered rows to a CSV file.

---

## Scripts

- **`npm run dev`** – Next.js dev server.
- **`npm run build` / `npm start`** – production build and start.
- **`npm run jobright:login`** – open Playwright browser to log in to Jobright (persistent context).
- **`npm run jobright:scan`** – run the Jobright Recommended scanner via Playwright.
- **`npm run test:documents`** – test resume + cover letter generation pipeline using a sample job.

---

## Safety & Secrets

- `.env` is **git-ignored**; never commit your `OPENAI_API_KEY` or database credentials.
- When sharing this repo publicly, verify:
  - No `.env` or other secret files are in Git history.
  - Resume templates and generated documents only include information you are comfortable sharing.

