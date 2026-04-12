require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/jj-apartelle';

app.use(cors());
app.use(express.json());

// Static files first (before auth so CSS/JS loads on login page)
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'jj-apartelle-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGODB_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  const publicPaths = ['/login.html', '/api/auth/login'];
  if (publicPaths.includes(req.path) || req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login.html');
};

app.use(requireAuth);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/guests', require('./routes/guests'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/settings', require('./routes/settings'));

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
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const daysInMonth = new Date(today.getUTCFullYear(), today.getUTCMonth() + 1, 0).getUTCDate();

    const [activeBookings, checkInBookings, checkOutBookings, monthIncome, monthExpense, totalGuests, monthOccupancy] = await Promise.all([
      Booking.find({ status: { $in: ['confirmed', 'checked-in'] }, checkIn: { $lte: today }, checkOut: { $gt: today } }),
      Booking.find({ checkIn: { $gte: today, $lt: tomorrow }, status: { $nin: ['cancelled'] } }).select('guestName guestContact doorNumber checkIn checkOut guestCount source'),
      Booking.find({ checkOut: { $gte: today, $lt: tomorrow }, status: { $nin: ['cancelled'] } }).select('guestName guestContact doorNumber checkIn checkOut guestCount source'),
      Transaction.aggregate([{ $match: { type: 'income', date: { $gte: monthStart, $lt: monthEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'expense', date: { $gte: monthStart, $lt: monthEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Guest.countDocuments(),
      Booking.aggregate([
        { $match: { status: { $nin: ['cancelled'] }, checkIn: { $lt: monthEnd }, checkOut: { $gt: monthStart } } },
        { $group: { _id: '$doorNumber', nights: { $sum: '$nights' } } }
      ])
    ]);

    const occupiedDoors = activeBookings.map(b => b.doorNumber);
    const activeBookingsByDoor = {};
    activeBookings.forEach(b => {
      activeBookingsByDoor[b.doorNumber] = {
        guestName: b.guestName,
        guestContact: b.guestContact,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        guestCount: b.guestCount,
        status: b.status,
        _id: b._id
      };
    });

    const occupancyByDoor = {};
    monthOccupancy.forEach(o => {
      occupancyByDoor[o._id] = Math.min(100, parseFloat(((Math.min(o.nights, daysInMonth) / daysInMonth) * 100).toFixed(1)));
    });

    res.json({
      occupiedDoors,
      activeBookingsByDoor,
      availableDoors: [1, 2, 3, 4].filter(d => !occupiedDoors.includes(d)),
      todayCheckIns: checkInBookings.length,
      todayCheckOuts: checkOutBookings.length,
      todayCheckInDetails: checkInBookings,
      todayCheckOutDetails: checkOutBookings,
      monthIncome: monthIncome[0]?.total || 0,
      monthExpense: monthExpense[0]?.total || 0,
      monthNet: (monthIncome[0]?.total || 0) - (monthExpense[0]?.total || 0),
      occupancyByDoor,
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