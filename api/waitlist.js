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

  console.log('Received email:', email);
  if (!isValidEmail(email)) {
    console.log('Invalid email format');
    res.status(400).json({ error: 'Invalid email' });
    return;
  }

  const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
  console.log('Airtable URL:', airtableUrl);

  try {
    const airtableRes = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { Email: email } })
    });
    const data = await airtableRes.json();
    console.log('Airtable response:', data);
    if (!airtableRes.ok) {
      throw new Error(JSON.stringify(data));
    }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Airtable error:', err);
    res.status(500).json({ error: 'Failed to save to waitlist.', details: err.message });
  }
}; 