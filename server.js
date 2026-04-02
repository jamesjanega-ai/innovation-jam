// ============================================================
// INNOVATION JAM — server.js
// Serves innovation_jam.html
// Proxies Apps Script calls (fixes CORS)
// Proxies Anthropic API calls (future use)
// ============================================================

const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json({ limit: '2mb' }));

// ─── SERVE STATIC FILES ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Innovation Jam', time: new Date().toISOString() });
});

// ─── APPS SCRIPT PROXY — GET ──────────────────────────────────────────────────
// Client calls GET /api/sheets?action=latestRun&run=APR02-A
// Server forwards to Apps Script — no CORS issues server-to-server
app.get('/api/sheets', async (req, res) => {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({
      success: false,
      error: 'APPS_SCRIPT_URL not set in Render environment variables'
    });
  }
  try {
    const params   = new URLSearchParams(req.query);
    const fullUrl  = `${scriptUrl}?${params.toString()}`;
    const response = await fetch(fullUrl);
    const data     = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Apps Script GET proxy error:', err.message);
    res.status(500).json({ success: false, error: 'Proxy GET error: ' + err.message });
  }
});

// ─── APPS SCRIPT PROXY — POST ─────────────────────────────────────────────────
// Client calls POST /api/sheets with JSON body
// Server forwards to Apps Script — no CORS issues server-to-server
app.post('/api/sheets', async (req, res) => {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({
      success: false,
      error: 'APPS_SCRIPT_URL not set in Render environment variables'
    });
  }
  try {
    const response = await fetch(scriptUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Apps Script POST proxy error:', err.message);
    res.status(500).json({ success: false, error: 'Proxy POST error: ' + err.message });
  }
});

// ─── ANTHROPIC PROXY ──────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 512, ...req.body })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data });
    res.json(data);
  } catch (err) {
    console.error('Anthropic proxy error:', err.message);
    res.status(500).json({ error: 'Anthropic API call failed: ' + err.message });
  }
});

// ─── CATCH-ALL → SERVE GAME ───────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'innovation_jam.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Innovation Jam running on port ${PORT}`);
  console.log(`Admin: http://localhost:${PORT}?admin=true`);
});
