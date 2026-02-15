const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/fetch-pdf', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A URL is required.' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported.' });
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'EyeEasyPaperReader/1.0' },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Remote server returned ${response.status}.` });
    }

    const contentType = response.headers.get('content-type') || '';
    const isPdf =
      contentType.includes('application/pdf') ||
      url.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      return res.status(400).json({
        error: 'The URL does not appear to point to a PDF file.',
      });
    }

    res.setHeader('Content-Type', 'application/pdf');

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    console.error('Fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch the PDF.' });
  }
});

app.listen(PORT, () => {
  console.log(`Eye-Easy Paper Reader running at http://localhost:${PORT}`);
});
