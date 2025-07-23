// Vercel serverless function for waitlist submissions
const fs = require('fs');
const path = require('path');

const WAITLIST_FILE = path.join(__dirname, 'waitlist.json');

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let email = '';
  try {
    email = req.body.email || (typeof req.body === 'string' ? JSON.parse(req.body).email : '');
  } catch {
    email = '';
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }

  let waitlist = [];
  if (fs.existsSync(WAITLIST_FILE)) {
    try {
      waitlist = JSON.parse(fs.readFileSync(WAITLIST_FILE, 'utf8'));
    } catch {
      waitlist = [];
    }
  }

  if (waitlist.includes(email)) {
    res.status(200).json({ success: true, message: 'Already on waitlist' });
    return;
  }

  waitlist.push(email);
  fs.writeFileSync(WAITLIST_FILE, JSON.stringify(waitlist, null, 2));

  res.status(200).json({ success: true });
}; 