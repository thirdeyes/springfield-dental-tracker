// Vercel serverless function: passcode-gated reader/writer for feedback notes.
// Notes are markdown files committed to /feedback in the GitHub repo, so the
// GitHub token never reaches the browser and notes show up in Michael's repo.

const REPO = process.env.GITHUB_REPO || 'thirdeyes/springfield-dental-tracker';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const DIR = 'feedback';

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'springfield-dental-review',
  };
}

function slugify(s) {
  return (s || 'note')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'note';
}

module.exports = async (req, res) => {
  // ── Passcode gate ─────────────────────────────────────
  const expected = process.env.REVIEW_PASSCODE;
  const given = req.headers['x-review-passcode'];
  if (!expected || given !== expected) {
    res.status(401).json({ error: 'Invalid or missing passcode.' });
    return;
  }
  if (!process.env.GITHUB_TOKEN) {
    res.status(500).json({ error: 'Server missing GITHUB_TOKEN.' });
    return;
  }

  // ── List notes ────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const listResp = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${DIR}?ref=${encodeURIComponent(BRANCH)}`,
        { headers: ghHeaders() }
      );
      if (listResp.status === 404) {
        res.status(200).json({ notes: [] }); // folder not created yet
        return;
      }
      if (!listResp.ok) {
        const detail = (await listResp.text()).slice(0, 300);
        res.status(502).json({ error: 'GitHub list failed.', detail });
        return;
      }
      const items = await listResp.json();
      const mdFiles = (Array.isArray(items) ? items : [])
        .filter((f) => f.type === 'file' && f.name.endsWith('.md'))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 50);

      const notes = await Promise.all(
        mdFiles.map(async (f) => {
          let content = '';
          try {
            const fr = await fetch(f.url, { headers: ghHeaders() });
            if (fr.ok) {
              const j = await fr.json();
              content = Buffer.from(j.content || '', 'base64').toString('utf-8');
            }
          } catch (_) {}
          return { name: f.name, path: f.path, html_url: f.html_url, content };
        })
      );
      res.status(200).json({ notes });
    } catch (e) {
      res.status(502).json({ error: 'Could not reach GitHub.' });
    }
    return;
  }

  // ── Save a new note ───────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const title = (typeof body.title === 'string' ? body.title : '').trim();
    const markdown = typeof body.markdown === 'string' ? body.markdown : '';
    if (!markdown.trim()) {
      res.status(400).json({ error: 'markdown is required.' });
      return;
    }
    if (markdown.length > 100000) {
      res.status(400).json({ error: 'Note too large.' });
      return;
    }

    // Server controls the path — reviewers cannot write arbitrary repo paths.
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const stamp = now.toISOString().slice(11, 16).replace(':', '');
    const path = `${DIR}/${date}-${stamp}-${slugify(title)}.md`;

    const author = (typeof body.author === 'string' ? body.author : '').trim() || 'Reviewer';
    const heading = `# ${title || 'Feedback note'}\n\n_Saved ${now.toISOString()} by ${author}_\n\n`;
    const fileBody = heading + markdown.trim() + '\n';

    try {
      const putResp = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`,
        {
          method: 'PUT',
          headers: ghHeaders(),
          body: JSON.stringify({
            message: `Add feedback note: ${title || path}`,
            content: Buffer.from(fileBody, 'utf-8').toString('base64'),
            branch: BRANCH,
          }),
        }
      );
      if (!putResp.ok) {
        const detail = (await putResp.text()).slice(0, 300);
        res.status(502).json({ error: 'GitHub commit failed.', detail });
        return;
      }
      const j = await putResp.json();
      res.status(200).json({ ok: true, path, html_url: j.content && j.content.html_url });
    } catch (e) {
      res.status(502).json({ error: 'Could not reach GitHub.' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
