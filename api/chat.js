// Vercel serverless function: passcode-gated proxy to the Claude API.
// The Anthropic API key lives only here (env var), never in the browser.
// Streams the model's reply back to the client as Server-Sent Events.

const MODEL = 'claude-opus-4-8';

const SYSTEM_PROMPT = `You are a product reviewer's assistant embedded in "Springfield Dental Complex — Lab Case Tracker", a single-page web app used by a dental practice to track lab cases.

Your job: help reviewers and contributors give feedback, ask questions, and discuss options for future changes BEFORE the developer (Michael) ships the next deploy. Be concrete, concise, and practical. When the reviewer is weighing a change, lay out the tradeoffs and give a recommendation. You are discussing the app's design — you are not editing code.

What the app currently does:
- Single static index.html (vanilla JS), deployed on Vercel.
- THREE tabs plus controls in the header:
  - Schedule (Gantt): patient rows grouped by treating dentist; horizontal bars span the lab lead-up window and END at the appointment date. Bars are colored by a RAG (red/amber/green) status derived from a per-case "lab checklist":
      green = all checklist items done; red = appointment is <= 3 days out with items still unchecked; yellow = in progress otherwise.
    Default bar length is the treatment-type lead time (~3 weeks for crowns/veneers/bridges/implants, ~4 weeks dentures/partials, ~2 weeks guards/appliances). A small dot shows procedure type; a badge shows items left or a check. Bars also show ▲ (missing insertion date) and ● (missing follow-up date) warning icons. Clicking a bar opens a quick popover with a uniform status pill and the checklist as checkboxes you can toggle without opening the full editor. Clicking a name opens a full edit drawer.
  - Huddle: a consolidated 3-column board — Today's Cases / Needs Attention / Overdue — each scrollable, with per-case flag icons (🔴 high priority, ⚠️ needs review, ▲/● missing dates, ☐N unchecked items, 🐢 aging 7d+, ↩️ returned). A small Case History strip and a compact legend footer.
  - Lab Portals: cards linking out to lab websites (open in a new tab).
- A header "Metrics" button opens a Monthly Snapshot modal (delivered this month, missed/overdue, outstanding, at-risk, awaiting approval, avg turnaround, by-status and by-provider breakdowns).
- There is also a New Case modal and a per-case edit drawer (status checklist, dates incl. insertion + follow-up, provider, procedure, shade, scanner, notes).
- An older "Agenda" day-grid view exists in the code but is unlinked from the nav.

Guidance:
- Ground answers in the features above. If asked about something not present, say so and discuss how it could be added.
- Keep replies focused and skimmable; use short markdown (bullets, bold) when it helps.
- If the reviewer asks you to capture the discussion, you can produce a clean markdown feedback note (Summary, Requested changes, Open questions). The app has a "Save as note" action that commits such notes to the repo for Michael to review.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ── Passcode gate ─────────────────────────────────────
  const expected = process.env.REVIEW_PASSCODE;
  const given = req.headers['x-review-passcode'];
  if (!expected || given !== expected) {
    res.status(401).json({ error: 'Invalid or missing passcode.' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY.' });
    return;
  }

  // ── Validate the conversation ─────────────────────────
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required.' });
    return;
  }
  // Basic guardrails: cap turns and per-message length.
  if (messages.length > 60) {
    res.status(400).json({ error: 'Conversation too long.' });
    return;
  }
  const clean = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) {
      res.status(400).json({ error: 'Bad message role.' });
      return;
    }
    const content = typeof m.content === 'string' ? m.content : '';
    if (content.length > 8000) {
      res.status(400).json({ error: 'Message too long (8000 char max).' });
      return;
    }
    clean.push({ role: m.role, content });
  }

  // ── Call Claude (streaming) ───────────────────────────
  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        stream: true,
        messages: clean,
      }),
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the model API.' });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 500); } catch (_) {}
    res.status(upstream.status || 502).json({ error: 'Model API error.', detail });
    return;
  }

  // Pipe the SSE stream straight through; the browser parses it.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    for await (const chunk of upstream.body) {
      res.write(Buffer.from(chunk));
    }
  } catch (e) {
    // Client likely disconnected; nothing else to do.
  }
  res.end();
};
