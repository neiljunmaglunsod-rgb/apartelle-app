require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
dns.setDefaultResultOrder('ipv4first');
const mongoose = require('mongoose');
const User = require('./models/User');

// ── Set your credentials here ──────────────────────────
const USERNAME = 'admin';
const PASSWORD = 'admin123';
const ROLE     = 'admin';       // 'admin' or 'staff'
// ───────────────────────────────────────────────────────

async function createAdmin() {
  await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
  console.log('Connected to MongoDB');

  const existing = await User.findOne({ username: USERNAME });
  if (existing) {
    console.log(`User "${USERNAME}" already exists.`);
    process.exit(0);
  }

  const user = new User({ username: USERNAME, password: PASSWORD, role: ROLE });
  await user.save();
  console.log(`✓ Created ${ROLE} user: ${USERNAME}`);
  process.exit(0);
}

createAdmin().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
