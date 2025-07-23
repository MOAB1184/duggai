// Vercel serverless function for waitlist submissions
const fetch = require('node-fetch');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = 'Waitlist';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }

  // Add to Airtable
  try {
    const airtableRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: { Email: email } })
      }
    );
    if (!airtableRes.ok) {
      throw new Error('Airtable error');
    }
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save to waitlist.' });
  }
}; 