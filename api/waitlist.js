// Vercel serverless function for waitlist submissions
const fetch = require('node-fetch');

const NOCODEAPI_URL = process.env.NOCODEAPI_URL; // Set this in your Vercel env

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
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

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }

  try {
    // NoCodeAPI expects an array of arrays for rows
    const response = await fetch(NOCODEAPI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([[email]])
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save to waitlist.', details: err.message });
  }
}; 