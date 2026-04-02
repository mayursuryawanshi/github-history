import { Octokit } from '@octokit/rest';

/**
 * Fetches all repos a user has access to (owned + collaborated).
 */
export async function fetchUserRepos(username, token) {
  const octokit = new Octokit({ auth: token });
  const repos = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      page,
      sort: 'updated',
      direction: 'desc',
      affiliation: 'owner,collaborator,organization_member',
    });

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

  return repos;
}

/**
 * Streams PRs page-by-page, calling callbacks for real-time updates.
 * If repos array is provided and non-empty, fetches PRs per repo.
 */
export async function streamPRs(username, token, { repos, startDate, endDate } = {}, callbacks) {
  const octokit = new Octokit({ auth: token });

  let dateQuery = '';
  if (startDate) dateQuery += ` created:>=${startDate}`;
  if (endDate)   dateQuery += ` created:<=${endDate}`;

  if (repos && repos.length > 0) {
    // Fetch per-repo to respect the filter
    let grandTotal = 0;
    for (const repo of repos) {
      callbacks.onPageStart(`${repo}`);

      let page = 1;
      while (true) {
        const { data } = await octokit.rest.search.issuesAndPullRequests({
          q: `type:pr author:${username} repo:${repo}${dateQuery}`,
          per_page: 100,
          page,
          sort: 'created',
          order: 'desc',
        });

        if (data.items.length === 0) break;

        const prs = mapItems(data.items);
        grandTotal += prs.length;
        callbacks.onPRs(prs, grandTotal);

        if (data.items.length < 100 || grandTotal >= 1000) break;
        page++;
        await sleep(2000);
      }

      await sleep(2000);
    }
    callbacks.onDone(grandTotal);
  } else {
    // Fetch all PRs across all repos
    let page = 1;
    let total = 0;

    while (true) {
      callbacks.onPageStart(page);

      const { data } = await octokit.rest.search.issuesAndPullRequests({
        q: `type:pr author:${username}${dateQuery}`,
        per_page: 100,
        page,
        sort: 'created',
        order: 'desc',
      });

      if (data.items.length === 0) break;

      const prs = mapItems(data.items);
      total += prs.length;
      callbacks.onPRs(prs, total);

      if (data.items.length < 100 || total >= 1000) break;
      page++;
      await sleep(2000);
    }

    callbacks.onDone(total);
  }
}

function mapItems(items) {
  return items.map(item => ({
    title: item.title,
    url: item.html_url,
    repo: extractRepo(item.repository_url),
    state: item.state,
    merged: !!item.pull_request?.merged_at,
    mergedAt: item.pull_request?.merged_at || null,
    createdAt: item.created_at,
    closedAt: item.closed_at || null,
    number: item.number,
    labels: item.labels.map(l => l.name),
    body: item.body || '',
  }));
}

function extractRepo(repositoryUrl) {
  return repositoryUrl.replace('https://api.github.com/repos/', '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
