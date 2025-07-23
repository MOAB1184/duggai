// Vercel serverless function for waitlist submissions
const fetch = require('node-fetch');

const NOCODEAPI_URL = process.env.NOCODEAPI_URL; // Set this in your Vercel env

module.exports = async (req, res) => {
  console.log('Waitlist API called');
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let email = '';
  if (req.body && req.body.email) {
    email = req.body.email;
  } else if (typeof req.body === 'string') {
    try {
      email = JSON.parse(req.body).email;
    } catch {
      email = '';
    }
  }

  console.log('Received email:', email);
  if (!email || !/^[^\s@]+@[^-\s@]+\.[^\s@]+$/.test(email)) {
    console.log('Invalid email format');
    res.status(400).json({ error: 'Invalid email' });
    return;
  }

  console.log('NoCodeAPI URL:', NOCODEAPI_URL);

  try {
    const response = await fetch(NOCODEAPI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([[email]])
    });
    const data = await response.json();
    console.log('NoCodeAPI response:', data);
    if (!response.ok) {
      console.error('NoCodeAPI error response:', data);
      throw new Error(JSON.stringify(data));
    }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Waitlist API error:', err);
    res.status(500).json({ error: 'Failed to save to waitlist.', details: err && err.message ? err.message : String(err) });
  }
}; 