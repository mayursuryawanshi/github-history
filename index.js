import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchUserRepos, streamPRs } from './src/fetchPRs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fetch repos the user has contributed to
app.get('/api/repos', async (req, res) => {
  const { username, token } = req.query;

  if (!username || !token) {
    return res.status(400).json({ error: 'Missing username or token' });
  }

  try {
    const repos = await fetchUserRepos(username, token);
    res.json(repos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE endpoint — streams PR data in real-time
app.get('/api/prs', async (req, res) => {
  const { username, token, startDate, endDate } = req.query;
  // repos comes as comma-separated string
  const repos = req.query.repos ? req.query.repos.split(',') : [];

  if (!username || !token) {
    return res.status(400).json({ error: 'Missing username or token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await streamPRs(username, token, { repos, startDate, endDate }, {
      onPageStart: (page) => send('status', { message: `Fetching page ${page}...` }),
      onPRs: (prs, total) => send('prs', { prs, total }),
      onDone: (total) => send('done', { total }),
    });
  } catch (err) {
    send('error', { message: err.message });
  }

  res.end();
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
});
