require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/jj-apartelle';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/guests', require('./routes/guests'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/transactions', require('./routes/transactions'));

// Room config endpoint
app.get('/api/rooms', (req, res) => {
  res.json([
    { door: 1, rate: 2700, maxGuests: 6, extraBedCharge: 250 },
    { door: 2, rate: 2400, maxGuests: 5, extraBedCharge: 250 },
    { door: 3, rate: 1600, maxGuests: 3, extraBedCharge: 250 },
    { door: 4, rate: 2800, maxGuests: 8, extraBedCharge: 250 }
  ]);
});

// Dashboard stats
app.get('/api/dashboard', async (req, res) => {
  try {
    const Booking = require('./models/Booking');
    const Transaction = require('./models/Transaction');
    const Guest = require('./models/Guest');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const [activeBookings, todayCheckIns, todayCheckOuts, monthIncome, monthExpense, totalGuests] = await Promise.all([
      Booking.find({ status: { $in: ['confirmed', 'checked-in'] }, checkIn: { $lte: today }, checkOut: { $gt: today } }),
      Booking.countDocuments({ checkIn: { $gte: today, $lt: tomorrow }, status: { $ne: 'cancelled' } }),
      Booking.countDocuments({ checkOut: { $gte: today, $lt: tomorrow }, status: { $ne: 'cancelled' } }),
      Transaction.aggregate([{ $match: { type: 'income', date: { $gte: monthStart, $lt: monthEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'expense', date: { $gte: monthStart, $lt: monthEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Guest.countDocuments()
    ]);

    const occupiedDoors = activeBookings.map(b => b.doorNumber);

    res.json({
      occupiedDoors,
      availableDoors: [1, 2, 3, 4].filter(d => !occupiedDoors.includes(d)),
      todayCheckIns,
      todayCheckOuts,
      monthIncome: monthIncome[0]?.total || 0,
      monthExpense: monthExpense[0]?.total || 0,
      monthNet: (monthIncome[0]?.total || 0) - (monthExpense[0]?.total || 0),
      totalGuests
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

mongoose.connect(MONGODB_URI, { family: 4 })
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => console.log(`J&J Apartelle running on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
