// ============================================================
// INNOVATION JAM — server.js
// Serves innovation_jam.html
// Proxies Apps Script calls (fixes CORS + follows 302 redirects)
// ============================================================

const express  = require('express');
const path     = require('path');
const https    = require('https');
const http     = require('http');
const { URL }  = require('url');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ─── SERVE STATIC FILES ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Innovation Jam', time: new Date().toISOString() });
});

// ─── POST WITH REDIRECT HELPER ────────────────────────────────────────────────
// Google Apps Script redirects POST requests (302). Node fetch drops the body
// on redirect. This helper manually follows the redirect, preserving the body.
function postWithRedirect(urlStr, bodyObj, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));

    const parsed   = new URL(urlStr);
    const lib      = parsed.protocol === 'https:' ? https : http;
    const bodyStr  = JSON.stringify(bodyObj);

    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };

    const req = lib.request(opts, (res) => {
      // Follow 301/302/303/307/308 redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        console.log(`Redirect ${res.statusCode} → ${nextUrl}`);
        // Consume response body before following redirect
        res.resume();
        return postWithRedirect(nextUrl, bodyObj, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }

      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: raw }));
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ─── APPS SCRIPT PROXY — GET ──────────────────────────────────────────────────
app.get('/api/sheets', async (req, res) => {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({ success: false, error: 'APPS_SCRIPT_URL not configured' });
  }
  try {
    const params  = new URLSearchParams(req.query);
    const fullUrl = `${scriptUrl}?${params.toString()}`;
    const response = await fetch(fullUrl);
    const text = await response.text();

    // Detect HTML response (Apps Script error or auth wall)
    if (text.trimStart().startsWith('<')) {
      console.error('Apps Script GET returned HTML (not JSON). First 300 chars:\n', text.substring(0, 300));
      return res.status(502).json({
        success: false,
        error: 'Apps Script returned HTML instead of JSON — check deployment permissions or script errors.',
        hint: text.substring(0, 300)
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error('Apps Script GET — JSON parse failed. Raw response:\n', text.substring(0, 300));
      return res.status(502).json({
        success: false,
        error: 'Apps Script GET response was not valid JSON.',
        hint: text.substring(0, 300)
      });
    }

    res.json(data);
  } catch (err) {
    console.error('Apps Script GET error:', err.message);
    res.status(500).json({ success: false, error: 'Proxy GET error: ' + err.message });
  }
});

// ─── APPS SCRIPT PROXY — POST (with redirect handling) ────────────────────────
app.post('/api/sheets', async (req, res) => {
  const scriptUrl = process.env.APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return res.status(500).json({ success: false, error: 'APPS_SCRIPT_URL not configured' });
  }
  try {
    const { statusCode, body } = await postWithRedirect(scriptUrl, req.body);

    // Detect HTML response (Apps Script error page or Google login wall)
    if (body.trimStart().startsWith('<')) {
      console.error(
        `Apps Script POST returned HTML (not JSON). action="${req.body.action}" statusCode=${statusCode}\n` +
        'First 300 chars of response:\n' + body.substring(0, 300)
      );
      return res.status(502).json({
        success: false,
        error: 'Apps Script returned HTML instead of JSON.',
        diagnosis: 'Either the Apps Script has a runtime error, or the deployment is not set to "Anyone, even anonymous". Check Deploy → Manage deployments in Apps Script.',
        hint: body.substring(0, 300)
      });
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch (parseErr) {
      console.error(
        `Apps Script POST — JSON parse failed. action="${req.body.action}" statusCode=${statusCode}\n` +
        'Raw response:\n' + body.substring(0, 300)
      );
      return res.status(502).json({
        success: false,
        error: 'Apps Script response was not valid JSON.',
        hint: body.substring(0, 300)
      });
    }

    res.status(statusCode >= 400 ? statusCode : 200).json(data);
  } catch (err) {
    console.error('Apps Script POST error:', err.message);
    res.status(500).json({ success: false, error: 'Proxy POST error: ' + err.message });
  }
});

// ─── ANTHROPIC PROXY ──────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
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

// ─── CATCH-ALL ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'innovation_jam.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Innovation Jam running on port ${PORT}`);
});
