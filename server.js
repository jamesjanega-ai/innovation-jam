// ============================================================
// INNOVATION JAM — server.js
// ============================================================
// Serves innovation_jam.html and proxies Anthropic API calls.
// Apps Script calls go direct from client — no proxy needed.
// ============================================================

const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json({ limit: '2mb' }));

// ─── SERVE STATIC FILES ───────────────────────────────────────────────────────
// innovation_jam.html lives in /public
app.use(express.static(path.join(__dirname, 'public')));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'Innovation Jam',
    time:    new Date().toISOString()
  });
});

// ─── ANTHROPIC PROXY ──────────────────────────────────────────────────────────
// Used for Hard Mode fuzzy scoring if enabled in future builds.
// Client sends POST /api/claude with a standard messages payload.
// Server injects the API key and forwards to Anthropic.
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':            'application/json',
        'x-api-key':               apiKey,
        'anthropic-version':       '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 512,
        ...req.body
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    res.json(data);

  } catch (err) {
    console.error('Anthropic proxy error:', err.message);
    res.status(500).json({ error: 'Anthropic API call failed: ' + err.message });
  }
});

// ─── CATCH-ALL → SERVE GAME ───────────────────────────────────────────────────
// Any unmatched route returns the game HTML.
// This allows the Admin screen (?admin=true) and other
// query-param routes to work without 404s.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'innovation_jam.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Innovation Jam running on port ${PORT}`);
  console.log(`Admin screen: http://localhost:${PORT}?admin=true`);
});
