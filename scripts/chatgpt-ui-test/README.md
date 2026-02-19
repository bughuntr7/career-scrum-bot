# ChatGPT UI – test vs full docx

This folder holds sample inputs for the **ChatGPT web UI** test script. Both scripts use your paid ChatGPT session (no OpenAI API).

| Script | Purpose | Output |
|--------|--------|--------|
| `npm run test:chatgpt-ui` | Quick test with sample data | Plain `.txt` in `scripts/chatgpt-ui-test-output/` |
| **`npm run docs:chatgpt-ui`** | **Real flow: your templates + styled .docx** | **`Resumes/<Company+Role>/Jiayong Lin.docx`, `Cover Letter.docx`, `job description.txt`** |

For a run that matches the main app (styling + .docx), use **`npm run docs:chatgpt-ui`** with either a job ID from the DB or with env vars (see below).

## Sign-in workflow

**Option A – login first (recommended)**

```bash
npm run chatgpt:login
```

A browser opens. Log in to ChatGPT, wait until you see the chat interface, then press Enter in the terminal. Your session is saved and reused by `test:chatgpt-ui`.

**Option B – sign in when you run the test**

When you run `npm run test:chatgpt-ui`, if you’re not logged in, the script will ask you to log in in the browser and press Enter when done.

## Quick run

```bash
npm run test:chatgpt-ui
```

- Uses the same browser profile as `chatgpt:login` (default: `.jobbot/chatgpt` or `CHATGPT_CONTEXT_DIR`).
- Sends the same resume and cover letter prompts as the main app; saves replies to `scripts/chatgpt-ui-test-output/`.

## Options

- **Resume only:** `npm run test:chatgpt-ui -- --resume-only`
- **Cover letter only:** `npm run test:chatgpt-ui -- --cover-only`

## Custom inputs (env)

| Env var               | Description                          |
|-----------------------|--------------------------------------|
| `BASE_RESUME_FILE`    | Path to base resume text file        |
| `JOB_DESCRIPTION_FILE`| Path to job description text file    |
| `COMPANY`             | Company name (for cover letter)      |
| `JOB_TITLE`           | Job title (for cover letter)         |
| `CHATGPT_CONTEXT_DIR` | Browser profile dir (default: `.jobbot/chatgpt`) |

## Sample files

- `sample-base-resume.txt` – used if `BASE_RESUME_FILE` is not set.
- `sample-job-description.txt` – used if `JOB_DESCRIPTION_FILE` is not set.

## Full flow: styled .docx (same as main app)

**`npm run docs:chatgpt-ui`** uses the ChatGPT UI for generation but then applies **your templates** and writes **.docx** (and job description .txt) into **`Resumes/<Company+Role>/`**, just like the main app.

**By job ID (from DB):**

```bash
npm run docs:chatgpt-ui -- --job-id 42
```

Uses job 42’s company, title, and job description from the database. Base resume from `Resumes/Templates/Jiayong Lin_Sample.docx`.

**By files (no DB):**

```bash
set COMPANY=Acme Inc
set JOB_TITLE=Senior Engineer
set JOB_DESCRIPTION_FILE=C:\path\to\job-description.txt
npm run docs:chatgpt-ui
```

Optional: `BASE_RESUME_FILE` = path to your base resume .txt if you don’t use the Sample .docx. Optional: `RESUMES_OUTPUT_DIR` (default `Resumes`).

Output: `Resumes/<Company+Role>/Jiayong Lin.docx`, `Cover Letter.docx`, `job description.txt`.

## If the script breaks (UI changes)

OpenAI often changes the ChatGPT DOM. If "composer not found" or "reply not found" appears, the selectors in `scripts/testChatGPTUiGeneration.ts` or `scripts/generateDocumentsViaChatGPTUi.ts` may need updating (e.g. textarea, send button, assistant message container).
