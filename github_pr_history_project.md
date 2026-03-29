# GitHub PR History Fetcher — Project Documentation

> **Purpose**: Fetch and summarize your entire GitHub Pull Request history for appraisal/performance review periods.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Prerequisites](#2-prerequisites)
3. [Project Setup](#3-project-setup)
4. [GitHub Personal Access Token](#4-github-personal-access-token)
5. [Project Structure](#5-project-structure)
6. [Implementation](#6-implementation)
7. [Running the Tool](#7-running-the-tool)
8. [Sample Output](#8-sample-output)
9. [Enhancements & Extensions](#9-enhancements--extensions)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Project Overview

This CLI tool fetches **all Pull Requests authored by you** across GitHub — including open, closed, and merged PRs — and generates a structured Markdown report. Perfect for appraisal periods where you need a clear record of your contributions.

**What it does:**
- Fetches all PRs you've authored (across all repositories you've contributed to)
- Groups them by repository
- Shows PR title, status (merged/closed/open), dates, and URL
- Generates a clean Markdown report you can share or paste into a document

**Stack:**
- Node.js (no heavy frameworks)
- GitHub REST API v3 (via `@octokit/rest`)
- Runs entirely from the command line

---

## 2. Prerequisites

Make sure the following are installed on your machine:

| Tool | Version | Check |
|------|---------|-------|
| Node.js | v18+ | `node -v` |
| npm | v9+ | `npm -v` |
| Git | any | `git --version` |

---

## 3. Project Setup

### Step 1 — Create the project folder

```bash
mkdir github-pr-history
cd github-pr-history
```

### Step 2 — Initialize npm

```bash
npm init -y
```

### Step 3 — Install dependencies

```bash
npm install @octokit/rest dotenv
```

- **`@octokit/rest`** — Official GitHub REST API client for Node.js
- **`dotenv`** — Loads environment variables from a `.env` file

### Step 4 — Create a `.env` file

```bash
touch .env
```

Add the following to `.env`:

```env
GITHUB_TOKEN=your_personal_access_token_here
GITHUB_USERNAME=your_github_username_here
```

> ⚠️ **Never commit `.env` to Git.** Add it to `.gitignore` immediately.

### Step 5 — Create `.gitignore`

```bash
echo "node_modules/\n.env\noutput/" > .gitignore
```

---

## 4. GitHub Personal Access Token

You need a **Personal Access Token (PAT)** to authenticate with the GitHub API.

### How to generate one:

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
   - Direct link: https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Give it a name like `PR History Tool`
4. Set expiration as needed (e.g., 90 days)
5. Under **Scopes**, select:
   - ✅ `repo` — Full control of private repositories (needed to see private repo PRs)
   - ✅ `read:user` — Read user profile data
6. Click **"Generate token"**
7. **Copy the token immediately** — you won't see it again
8. Paste it into your `.env` file as `GITHUB_TOKEN`

> 💡 If you only work on public repos, you can select just `public_repo` instead of full `repo`.

---

## 5. Project Structure

```
github-pr-history/
├── .env                  # Your token and username (never commit this)
├── .gitignore
├── package.json
├── package-lock.json
├── index.js              # Main entry point
├── src/
│   ├── fetchPRs.js       # GitHub API calls
│   ├── formatReport.js   # Markdown report generator
│   └── utils.js          # Helper functions
└── output/
    └── pr-report.md      # Generated report (auto-created)
```

---

## 6. Implementation

### `index.js` — Entry Point

```javascript
import 'dotenv/config';
import { fetchAllPRs } from './src/fetchPRs.js';
import { generateReport } from './src/formatReport.js';
import fs from 'fs';
import path from 'path';

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

if (!USERNAME || !TOKEN) {
  console.error('❌ Missing GITHUB_USERNAME or GITHUB_TOKEN in .env');
  process.exit(1);
}

// Optional: filter by date range via CLI args
// Usage: node index.js 2024-01-01 2024-12-31
const [startDate, endDate] = process.argv.slice(2);

console.log(`\n🔍 Fetching PRs for: ${USERNAME}`);
if (startDate) console.log(`   From: ${startDate} → ${endDate || 'now'}`);

const prs = await fetchAllPRs(USERNAME, TOKEN, { startDate, endDate });

console.log(`\n✅ Found ${prs.length} pull requests\n`);

const report = generateReport(USERNAME, prs, { startDate, endDate });

// Write output
const outputDir = './output';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

const outputPath = path.join(outputDir, 'pr-report.md');
fs.writeFileSync(outputPath, report, 'utf-8');

console.log(`📄 Report saved to: ${outputPath}`);
console.log(`\n--- PREVIEW (first 500 chars) ---\n`);
console.log(report.substring(0, 500) + '...\n');
```

> Add `"type": "module"` to your `package.json` to use ES module imports.

---

### `src/fetchPRs.js` — GitHub API Calls

```javascript
import { Octokit } from '@octokit/rest';

/**
 * Fetches all PRs authored by the given username.
 * Uses GitHub Search API to find PRs across all repositories.
 */
export async function fetchAllPRs(username, token, { startDate, endDate } = {}) {
  const octokit = new Octokit({ auth: token });

  // Build the search query
  let query = `type:pr author:${username}`;
  if (startDate) query += ` created:>=${startDate}`;
  if (endDate)   query += ` created:<=${endDate}`;

  const allPRs = [];
  let page = 1;
  const perPage = 100; // max allowed by GitHub

  while (true) {
    console.log(`  Fetching page ${page}...`);

    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: perPage,
      page,
      sort: 'created',
      order: 'desc',
    });

    if (data.items.length === 0) break;

    for (const item of data.items) {
      allPRs.push({
        title: item.title,
        url: item.html_url,
        repo: extractRepo(item.repository_url),
        state: item.state,
        merged: item.pull_request?.merged_at ? true : false,
        mergedAt: item.pull_request?.merged_at || null,
        createdAt: item.created_at,
        closedAt: item.closed_at || null,
        number: item.number,
        body: item.body || '',
        labels: item.labels.map(l => l.name),
      });
    }

    // GitHub search API caps at 1000 results
    if (data.items.length < perPage || allPRs.length >= 1000) break;

    page++;

    // Respect rate limiting — GitHub allows 30 search requests/minute
    await sleep(2000);
  }

  return allPRs;
}

function extractRepo(repositoryUrl) {
  // e.g. https://api.github.com/repos/owner/repo-name → owner/repo-name
  return repositoryUrl.replace('https://api.github.com/repos/', '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

### `src/formatReport.js` — Markdown Report Generator

```javascript
/**
 * Generates a structured Markdown report from PR data.
 */
export function generateReport(username, prs, { startDate, endDate } = {}) {
  const now = new Date().toISOString().split('T')[0];
  const dateRange = startDate
    ? `${startDate} → ${endDate || now}`
    : `All time → ${now}`;

  const merged = prs.filter(pr => pr.merged);
  const open   = prs.filter(pr => pr.state === 'open');
  const closed = prs.filter(pr => pr.state === 'closed' && !pr.merged);

  // Group by repo
  const byRepo = groupByRepo(prs);

  let md = '';

  // Header
  md += `# GitHub Pull Request History\n\n`;
  md += `**Author:** @${username}  \n`;
  md += `**Period:** ${dateRange}  \n`;
  md += `**Generated:** ${now}  \n\n`;
  md += `---\n\n`;

  // Summary
  md += `## Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Total PRs | ${prs.length} |\n`;
  md += `| ✅ Merged | ${merged.length} |\n`;
  md += `| 🟡 Open | ${open.length} |\n`;
  md += `| ❌ Closed (unmerged) | ${closed.length} |\n`;
  md += `| Repositories | ${Object.keys(byRepo).length} |\n\n`;
  md += `---\n\n`;

  // By Repo
  md += `## Pull Requests by Repository\n\n`;

  for (const [repo, repoPRs] of Object.entries(byRepo)) {
    md += `### 📁 ${repo}\n\n`;
    md += `| # | Title | Status | Date |\n`;
    md += `|---|-------|--------|------|\n`;

    for (const pr of repoPRs) {
      const status = pr.merged
        ? '✅ Merged'
        : pr.state === 'open'
        ? '🟡 Open'
        : '❌ Closed';

      const date = pr.merged
        ? pr.mergedAt.split('T')[0]
        : pr.closedAt
        ? pr.closedAt.split('T')[0]
        : pr.createdAt.split('T')[0];

      const title = `[${pr.title}](${pr.url})`;
      md += `| #${pr.number} | ${title} | ${status} | ${date} |\n`;
    }

    md += `\n`;
  }

  md += `---\n\n`;

  // Chronological list
  md += `## Chronological PR List\n\n`;
  const sorted = [...prs].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  for (const pr of sorted) {
    const status = pr.merged ? '✅' : pr.state === 'open' ? '🟡' : '❌';
    md += `- ${status} **[${pr.title}](${pr.url})** — \`${pr.repo}\` _(${pr.createdAt.split('T')[0]})_\n`;
  }

  return md;
}

function groupByRepo(prs) {
  return prs.reduce((acc, pr) => {
    if (!acc[pr.repo]) acc[pr.repo] = [];
    acc[pr.repo].push(pr);
    return acc;
  }, {});
}
```

---

### `src/utils.js` — Helpers

```javascript
/**
 * Formats a date string to readable format
 */
export function formatDate(isoString) {
  if (!isoString) return 'N/A';
  return new Date(isoString).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Truncates text to a given length
 */
export function truncate(text, maxLength = 100) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}
```

---

### `package.json` — Final Version

```json
{
  "name": "github-pr-history",
  "version": "1.0.0",
  "description": "Fetch GitHub PR history for appraisal reports",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "fetch": "node index.js",
    "fetch:range": "node index.js"
  },
  "dependencies": {
    "@octokit/rest": "^20.0.0",
    "dotenv": "^16.0.0"
  }
}
```

---

## 7. Running the Tool

### Fetch ALL your PRs (no date filter)

```bash
node index.js
```

### Fetch PRs within a date range

```bash
node index.js 2024-04-01 2025-03-31
```

### Output

Your report will be saved to `output/pr-report.md`. Open it in any Markdown viewer (VS Code, GitHub, Notion, Obsidian) or paste it directly into your appraisal document.

---

## 8. Sample Output

```markdown
# GitHub Pull Request History

**Author:** @johndoe
**Period:** 2024-04-01 → 2025-03-31
**Generated:** 2025-03-28

---

## Summary

| Metric | Count |
|--------|-------|
| Total PRs | 47 |
| ✅ Merged | 41 |
| 🟡 Open | 3 |
| ❌ Closed (unmerged) | 3 |
| Repositories | 5 |

---

## Pull Requests by Repository

### 📁 myorg/backend-api

| # | Title | Status | Date |
|---|-------|--------|------|
| #234 | feat: add JWT refresh token logic | ✅ Merged | 2025-01-10 |
| #198 | fix: race condition in payment handler | ✅ Merged | 2024-11-05 |
...
```

---

## 9. Enhancements & Extensions

Once the base tool is working, here are ways to extend it:

| Enhancement | How |
|-------------|-----|
| **Filter by org/repo** | Add `repo:org/repo-name` to the search query in `fetchPRs.js` |
| **Export to CSV** | Add a `formatCSV.js` alongside `formatReport.js` |
| **Include PR descriptions** | Use `pr.body` already captured; add it to the report |
| **Add review stats** | Use `octokit.rest.pulls.listReviews()` per PR |
| **Interactive CLI** | Add `inquirer` npm package for prompts instead of CLI args |
| **GitHub Actions** | Schedule the tool to auto-generate monthly reports |
| **HTML output** | Convert Markdown to HTML using `marked` package |

---

## 10. Troubleshooting

| Problem | Fix |
|---------|-----|
| `401 Unauthorized` | Your token is wrong or expired — regenerate it |
| `422 Unprocessable Entity` | Search query is malformed — check username spelling |
| `Rate limit exceeded` | Add more `sleep()` between pages or wait 1 minute |
| PRs from private repos missing | Make sure your token has `repo` scope (not just `public_repo`) |
| Only seeing 1000 PRs | GitHub Search API hard-caps at 1000 — use date range filters to paginate in chunks (e.g., fetch year by year) |
| ES module error | Make sure `"type": "module"` is in `package.json` |

---

## Quick Start Checklist

- [ ] Node.js v18+ installed
- [ ] `npm install` done
- [ ] `.env` file created with `GITHUB_TOKEN` and `GITHUB_USERNAME`
- [ ] GitHub PAT generated with `repo` scope
- [ ] `node index.js 2024-04-01 2025-03-31` runs successfully
- [ ] `output/pr-report.md` is generated
- [ ] Markdown report reviewed and shared

---

*Built for appraisal season — know exactly what you shipped.* 🚀
