let allPRs = [];
let allRepos = [];

// TODO: Replace with your deployed Cloudflare Worker URL
const WORKER_URL = "https://github-history-ai.suryamayur34.workers.dev";

const ghHeaders = (token) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
});

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const mapItems = (items) =>
  items.map((item) => ({
    title: item.title,
    url: item.html_url,
    repo: item.repository_url.replace(
      "https://api.github.com/repos/",
      ""
    ),
    state: item.state,
    merged: !!item.pull_request?.merged_at,
    mergedAt: item.pull_request?.merged_at || null,
    createdAt: item.created_at,
    closedAt: item.closed_at || null,
    number: item.number,
    labels: item.labels.map((l) => l.name),
    body: item.body || "",
  }));

/** Collapse whitespace and cap length for AI context (GitHub search returns PR body). */
const prBodyForPrompt = (body, maxLen) => {
  if (!body || !String(body).trim()) return "";
  const oneLine = String(body).replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 3) + "...";
};

const updateSelectedCount = () => {
  const count = document.querySelectorAll(
    ".repo-item input:checked"
  ).length;
  document.getElementById(
    "selectedCount"
  ).innerHTML = `<strong>${count}</strong> selected`;
};

const getSelectedRepos = () =>
  Array.from(
    document.querySelectorAll(".repo-item input:checked")
  ).map((cb) => cb.value);

const renderRepoList = (repos) => {
  const list = document.getElementById("repoList");
  list.innerHTML = "";

  for (const repo of repos) {
    const div = document.createElement("div");
    div.className = "repo-item";
    div.dataset.name = repo.fullName.toLowerCase();
    div.onclick = (e) => {
      if (e.target.tagName !== "INPUT") {
        const cb = div.querySelector("input");
        cb.checked = !cb.checked;
      }
      updateSelectedCount();
    };

    const updated = new Date(repo.updatedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    div.innerHTML = `
    <input type="checkbox" value="${repo.fullName}">
    <div class="repo-item-info">
      <div class="repo-item-name">${repo.fullName}</div>
      <div class="repo-item-meta">Updated ${updated}</div>
    </div>
    ${repo.private ? '<span class="repo-badge">Private</span>' : ""}
  `;
    list.appendChild(div);
  }

  updateSelectedCount();
};

const filterRepos = () => {
  const query = document.getElementById("repoSearch").value.toLowerCase();
  document.querySelectorAll(".repo-item").forEach((item) => {
    item.style.display = item.dataset.name.includes(query) ? "" : "none";
  });
};

const toggleAllRepos = (select) => {
  const query = document.getElementById("repoSearch").value.toLowerCase();
  document.querySelectorAll(".repo-item").forEach((item) => {
    if (!query || item.dataset.name.includes(query)) {
      item.querySelector("input").checked = select;
    }
  });
  updateSelectedCount();
};

const loadRepos = async () => {
  const username = document.getElementById("username").value.trim();
  const token = document.getElementById("token").value.trim();

  if (!username || !token) {
    alert("Please enter both username and token.");
    return;
  }

  const btn = document.getElementById("loadReposBtn");
  btn.disabled = true;
  btn.textContent = "Loading...";

  try {
    const repos = [];
    let page = 1;

    while (true) {
      const res = await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`,
        { headers: ghHeaders(token) }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to load repos");
      }

      const data = await res.json();
      if (data.length === 0) break;

      for (const repo of data) {
        repos.push({
          fullName: repo.full_name,
          name: repo.name,
          owner: repo.owner.login,
          private: repo.private,
          updatedAt: repo.updated_at,
        });
      }

      if (data.length < 100) break;
      page++;
    }

    allRepos = repos;
    renderRepoList(allRepos);
    document.getElementById("repoSection").classList.add("visible");
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Load Repositories";
  }
};

const appendPRRows = (prs) => {
  const tbody = document.getElementById("prTableBody");
  for (const pr of prs) {
    const tr = document.createElement("tr");
    tr.dataset.status = pr.merged ? "merged" : pr.state;

    const statusClass = pr.merged ? "merged" : pr.state;
    const statusText = pr.merged
      ? "Merged"
      : pr.state === "open"
      ? "Open"
      : "Closed";

    const date = pr.merged
      ? pr.mergedAt?.split("T")[0]
      : pr.closedAt
      ? pr.closedAt.split("T")[0]
      : pr.createdAt.split("T")[0];

    const labels = pr.labels
      .map((l) => `<span class="label-tag">${l}</span>`)
      .join("");

    tr.innerHTML = `
    <td>#${pr.number}</td>
    <td><a href="${pr.url}" target="_blank">${pr.title}</a>${labels}</td>
    <td><span class="repo-name">${pr.repo}</span></td>
    <td><span class="badge ${statusClass}">${statusText}</span></td>
    <td>${date}</td>
  `;
    tbody.appendChild(tr);
  }
};

const updateCounts = () => {
  document.getElementById("totalCount").textContent = allPRs.length;
  document.getElementById("mergedCount").textContent = allPRs.filter(
    (p) => p.merged
  ).length;
  document.getElementById("openCount").textContent = allPRs.filter(
    (p) => p.state === "open"
  ).length;
  document.getElementById("closedCount").textContent = allPRs.filter(
    (p) => p.state === "closed" && !p.merged
  ).length;
};

const fetchPRs = async (fetchAll = false) => {
  const username = document.getElementById("username").value.trim();
  const token = document.getElementById("token").value.trim();

  if (!username || !token) {
    alert("Please enter both username and token.");
    return;
  }

  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const selectedRepos = fetchAll ? [] : getSelectedRepos();

  if (!fetchAll && selectedRepos.length === 0) {
    alert(
      'Please select at least one repository, or click "Fetch from All Repos".'
    );
    return;
  }

  // Reset UI
  allPRs = [];
  document.getElementById("prTableBody").innerHTML = "";
  document.getElementById("fetchBtn").disabled = true;
  document.getElementById("spinner").style.display = "";
  document.getElementById("statusBar").classList.add("visible");
  document.getElementById("summary").classList.add("visible");
  document.getElementById("results").classList.add("visible");
  document.getElementById("summaryPanel").classList.remove("visible");
  updateCounts();

  let dateQuery = "";
  if (startDate) dateQuery += ` created:>=${startDate}`;
  if (endDate) dateQuery += ` created:<=${endDate}`;

  try {
    if (selectedRepos.length > 0) {
      let grandTotal = 0;
      for (const repo of selectedRepos) {
        document.getElementById(
          "statusText"
        ).textContent = `Fetching ${repo}...`;

        let page = 1;
        while (true) {
          const q = `type:pr author:${username} repo:${repo}${dateQuery}`;
          const res = await fetch(
            `https://api.github.com/search/issues?q=${encodeURIComponent(
              q
            )}&per_page=100&page=${page}&sort=created&order=desc`,
            { headers: ghHeaders(token) }
          );

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || "API request failed");
          }

          const data = await res.json();
          if (data.items.length === 0) break;

          const prs = mapItems(data.items);
          grandTotal += prs.length;
          allPRs.push(...prs);
          document.getElementById(
            "statusText"
          ).textContent = `Fetched ${grandTotal} PRs so far...`;
          appendPRRows(prs);
          updateCounts();

          if (data.items.length < 100 || grandTotal >= 1000) break;
          page++;
          await sleep(2000);
        }
        await sleep(2000);
      }

      document.getElementById(
        "statusText"
      ).textContent = `Done! Found ${grandTotal} pull requests.`;
    } else {
      let page = 1;
      let total = 0;

      while (true) {
        document.getElementById(
          "statusText"
        ).textContent = `Fetching page ${page}...`;

        const q = `type:pr author:${username}${dateQuery}`;
        const res = await fetch(
          `https://api.github.com/search/issues?q=${encodeURIComponent(
            q
          )}&per_page=100&page=${page}&sort=created&order=desc`,
          { headers: ghHeaders(token) }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "API request failed");
        }

        const data = await res.json();
        if (data.items.length === 0) break;

        const prs = mapItems(data.items);
        total += prs.length;
        allPRs.push(...prs);
        document.getElementById(
          "statusText"
        ).textContent = `Fetched ${total} PRs so far...`;
        appendPRRows(prs);
        updateCounts();

        if (data.items.length < 100 || total >= 1000) break;
        page++;
        await sleep(2000);
      }

      document.getElementById(
        "statusText"
      ).textContent = `Done! Found ${total} pull requests.`;
    }
  } catch (err) {
    document.getElementById(
      "statusText"
    ).textContent = `Error: ${err.message}`;
  } finally {
    document.getElementById("spinner").style.display = "none";
    document.getElementById("fetchBtn").disabled = false;
  }
};

const filterPRs = (status, btn) => {
  document
    .querySelectorAll(".filter-tab")
    .forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");

  document.querySelectorAll("#prTableBody tr").forEach((tr) => {
    if (status === "all") {
      tr.style.display = "";
    } else {
      tr.style.display = tr.dataset.status === status ? "" : "none";
    }
  });
};

const showSummary = async () => {
  if (allPRs.length === 0) {
    alert("No PRs to summarize. Fetch pull requests first.");
    return;
  }

  const btn = document.getElementById("summarizeBtn");
  btn.disabled = true;
  btn.textContent = "Summarizing...";

  const username = document.getElementById("username").value.trim();
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const merged = allPRs.filter((p) => p.merged);
  const open = allPRs.filter((p) => p.state === "open");
  const closed = allPRs.filter((p) => p.state === "closed" && !p.merged);

  const byRepo = {};
  for (const pr of allPRs) {
    if (!byRepo[pr.repo]) byRepo[pr.repo] = [];
    byRepo[pr.repo].push(pr);
  }

  const period = startDate
    ? `${startDate} to ${endDate || "present"}`
    : "all time";

  // Show panel with loading state
  const panel = document.getElementById("summaryPanel");
  const body = document.getElementById("summaryBody");

  let statsHtml = `<div class="summary-overview">`;
  statsHtml += `<strong>@${username}</strong> authored <strong>${allPRs.length}</strong> pull requests`;
  statsHtml += ` across <strong class="highlight">${
    Object.keys(byRepo).length
  }</strong> repositories`;
  statsHtml += ` (${period}).<br>`;
  statsHtml += `<strong style="color:#3fb950">${merged.length}</strong> merged`;
  statsHtml += ` &middot; <strong style="color:#d29922">${open.length}</strong> open`;
  statsHtml += ` &middot; <strong style="color:#f85149">${closed.length}</strong> closed (unmerged)`;
  statsHtml += `</div>`;

  body.innerHTML =
    statsHtml +
    `<div style="padding:20px;text-align:center;color:#8b949e;"><div class="spinner" style="margin:0 auto 12px;"></div>Generating AI summary...</div>`;
  panel.classList.add("visible");
  panel.scrollIntoView({ behavior: "smooth" });

  // Build PR data for AI summary (title + labels + truncated body for substance)
  const BODY_MAX = 450;
  const prData = allPRs
    .map((pr) => {
      const status = pr.merged
        ? "Merged"
        : pr.state === "open"
        ? "Open"
        : "Closed";
      const date = pr.merged
        ? pr.mergedAt?.split("T")[0]
        : pr.closedAt
        ? pr.closedAt.split("T")[0]
        : pr.createdAt.split("T")[0];
      const labelPart = pr.labels.length
        ? ` [labels: ${pr.labels.join(", ")}]`
        : "";
      const rawBody = pr.body != null ? pr.body : "";
      const desc = prBodyForPrompt(rawBody, BODY_MAX);
      const descPart = desc
        ? `\n  Description: ${desc}`
        : "\n  Description: (none — infer only from title and labels)";
      return `- #${pr.number} "${pr.title}" [${status}] (${date}) in ${pr.repo}${labelPart}${descPart}`;
    })
    .join("\n");

  const prompt = `You are given pull requests authored by @${username} over ${period}. The list below is the full input; use every PR.

For each PR, produce exactly 2–3 sentences that describe what the author did: problem or goal, main change or area, and result or status if clear from the data. Ground every claim in the title, labels, and description; where the description is empty, infer conservatively from the title and labels only.

Data:
${prData}

Follow the system instructions for HTML output (<h3> per repo, <ul>/<li> per PR with class merged|open|closed, <strong> for #number and title, <p> for each sentence of detail).`;

  const MAX_PROMPT = 19500;
  let promptToSend = prompt;
  if (promptToSend.length > MAX_PROMPT) {
    promptToSend =
      promptToSend.slice(0, MAX_PROMPT - 280) +
      "\n\n[TRUNCATED: input exceeded size limit. Summarize all PRs shown above in full; omit PRs not listed above.]";
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptToSend }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "AI summary request failed");
    }

    const data = await res.json();
    const aiText = data.summary || "No summary generated.";

    // Convert markdown-style to HTML if needed, or use as-is if already HTML
    const aiHtml = aiText
      .replace(/```html\n?/g, "")
      .replace(/```\n?/g, "")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    body.innerHTML =
      statsHtml + `<div style="margin-top:16px;">${aiHtml}</div>`;
  } catch (err) {
    console.error("AI summarization error:", err);
    body.innerHTML =
      statsHtml +
      `<div style="padding:16px;color:#f85149;">Failed to generate AI summary: ${err.message}. Showing basic summary instead.</div>`;

    // Fallback to basic summary
    const sortedRepos = Object.entries(byRepo).sort(
      (a, b) => b[1].length - a[1].length
    );
    let fallbackHtml = "";
    for (const [repo, prs] of sortedRepos) {
      const m = prs.filter((p) => p.merged).length;
      const o = prs.filter((p) => p.state === "open").length;
      const c = prs.filter(
        (p) => p.state === "closed" && !p.merged
      ).length;
      fallbackHtml += `<h3>${repo} (${prs.length} PRs — ${m} merged, ${o} open, ${c} closed)</h3><ul>`;
      for (const pr of prs) {
        const cls = pr.merged ? "merged" : pr.state;
        const status = pr.merged
          ? "Merged"
          : pr.state === "open"
          ? "Open"
          : "Closed";
        const date = pr.merged
          ? pr.mergedAt?.split("T")[0]
          : pr.closedAt
          ? pr.closedAt.split("T")[0]
          : pr.createdAt.split("T")[0];
        fallbackHtml += `<li class="${cls}">#${pr.number} ${pr.title} — ${status} (${date})</li>`;
      }
      fallbackHtml += `</ul>`;
    }
    body.innerHTML = statsHtml + fallbackHtml;
  } finally {
    btn.disabled = false;
    btn.textContent = "Summarize";
  }
};

const copySummary = () => {
  const body = document.getElementById("summaryBody");
  const text = body.innerText || body.textContent;

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector(".copy-btn");
    btn.textContent = "Copied!";
    setTimeout(() => {
      btn.textContent = "Copy to Clipboard";
    }, 2000);
  });
};
