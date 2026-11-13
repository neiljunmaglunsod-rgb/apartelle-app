require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI, { family: 4 }).then(async () => {
  const existing = await User.findOne({ username: 'neil' });
  if (existing) {
    console.log('User already exists!');
  } else {
    await User.create({ username: 'neil', password: process.env.ADMIN_PASSWORD, role: 'admin' });
    console.log('Admin created!');
  }
  process.exit();
});