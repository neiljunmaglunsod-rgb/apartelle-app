const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const https = require('https');
const http = require('http');

async function fireWebhook(booking) {
  try {
    const setting = await Settings.findOne({ key: 'webhookUrl' });
    if (!setting || !setting.value) return;
    const url = new URL(setting.value);
    const payload = JSON.stringify({
      guestName: booking.guestName,
      guestContact: booking.guestContact || '',
      doorNumber: booking.doorNumber,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.nights,
      guestCount: booking.guestCount,
      totalPrice: booking.totalPrice,
      source: booking.source
    });
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options);
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch {}
}

// GET all bookings (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { status, door, month, year } = req.query;
    let query = {};
    if (status) query.status = status;
    if (door) query.doorNumber = parseInt(door);
    if (month && year) {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      query.checkIn = { $gte: start, $lt: end };
    }
    const bookings = await Booking.find(query).sort({ checkIn: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET availability for a date range (check which doors are occupied)
router.get('/availability', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end dates required' });
    const startDate = new Date(start);
    const endDate = new Date(end);

    // Find bookings that overlap with the date range
    const bookings = await Booking.find({
      status: { $nin: ['cancelled'] },
      checkIn: { $lt: endDate },
      checkOut: { $gt: startDate }
    }).select('doorNumber checkIn checkOut guestName status guestCount');

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET price preview
router.get('/price-preview', async (req, res) => {
  try {
    const { door, checkIn, checkOut, guestCount } = req.query;
    const ROOM_DEFAULTS = { 1: { rate: 2700, maxGuests: 6 }, 2: { rate: 2400, maxGuests: 5 }, 3: { rate: 1600, maxGuests: 3 }, 4: { rate: 2800, maxGuests: 8 } };
    const doorNum = parseInt(door);
    const config = ROOM_DEFAULTS[doorNum];
    if (!config) return res.status(400).json({ error: 'Invalid door' });

    const msPerDay = 1000 * 60 * 60 * 24;
    const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / msPerDay);
    if (nights < 1) return res.status(400).json({ error: 'Invalid dates' });

    const Settings = require('../models/Settings');
    const saved = await Settings.findOne({ key: `door_${doorNum}_rate` });
    const rate = saved ? Number(saved.value) : config.rate;

    const gc = parseInt(guestCount);
    const extraBeds = Math.max(0, gc - config.maxGuests);
    const extraCharge = extraBeds * 250 * nights;
    const totalPrice = rate * nights + extraCharge;

    res.json({ nights, baseRate: rate, extraBeds, extraCharge, totalPrice, maxGuests: config.maxGuests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single booking
router.get('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create booking
router.post('/', async (req, res) => {
  try {
    // Check for conflicts
    const { doorNumber, checkIn, checkOut } = req.body;
    const conflict = await Booking.findOne({
      doorNumber: parseInt(doorNumber),
      status: { $nin: ['cancelled'] },
      checkIn: { $lt: new Date(checkOut) },
      checkOut: { $gt: new Date(checkIn) }
    });
    if (conflict) {
      return res.status(409).json({ error: `Door ${doorNumber} is already booked from ${conflict.checkIn.toDateString()} to ${conflict.checkOut.toDateString()}` });
    }

    // Create or find guest
    let guest;
    if (req.body.guestId) {
      guest = await Guest.findById(req.body.guestId);
    }
    if (!guest && req.body.guestName) {
      guest = new Guest({ name: req.body.guestName, contact: req.body.guestContact || '' });
      await guest.save();
    }
    if (!guest) return res.status(400).json({ error: 'Guest info required' });

    const booking = new Booking({
      ...req.body,
      guestId: guest._id,
      guestName: guest.name,
      guestContact: guest.contact
    });
    await booking.save();

    // Auto-create income transaction
    const transaction = new Transaction({
      type: 'income',
      category: 'Room Rental',
      amount: booking.totalPrice,
      date: booking.checkIn,
      description: `Door ${booking.doorNumber} — ${booking.guestName} (${booking.nights} night${booking.nights > 1 ? 's' : ''})`,
      bookingId: booking._id
    });
    await transaction.save();

    // Fire n8n webhook (non-blocking)
    fireWebhook(booking);

    res.status(201).json({ booking, transaction });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update booking
router.put('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Check conflicts if dates/door changed
    const newDoor = req.body.doorNumber || booking.doorNumber;
    const newCheckIn = req.body.checkIn || booking.checkIn;
    const newCheckOut = req.body.checkOut || booking.checkOut;
    const conflict = await Booking.findOne({
      _id: { $ne: booking._id },
      doorNumber: parseInt(newDoor),
      status: { $nin: ['cancelled'] },
      checkIn: { $lt: new Date(newCheckOut) },
      checkOut: { $gt: new Date(newCheckIn) }
    });
    if (conflict) {
      return res.status(409).json({ error: `Door ${newDoor} is already booked for those dates` });
    }

    Object.assign(booking, req.body);
    await booking.save();

    // Update linked income transaction amount
    await Transaction.findOneAndUpdate(
      { bookingId: booking._id, type: 'income' },
      { amount: booking.totalPrice, description: `Door ${booking.doorNumber} — ${booking.guestName} (${booking.nights} night${booking.nights > 1 ? 's' : ''})` }
    );

    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE booking
router.delete('/:id', async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    await Transaction.deleteOne({ bookingId: req.params.id });
    res.json({ message: 'Booking deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Laundry loads per door
const LAUNDRY_LOADS = { 1: 2, 2: 1, 3: 1, 4: 2 };
const LAUNDRY_RATE  = 200;
const CLEANING_FEE  = 300;

// POST checkout — marks checked-out and auto-posts cleaning + laundry fees
router.post('/:id/checkout', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    booking.status = 'checked-out';
    await booking.save();

    // Guard: skip if auto-fees already exist for this booking
    const existing = await Transaction.findOne({
      bookingId: booking._id,
      description: { $regex: /^Auto:/ }
    });
    if (existing) {
      return res.json({ booking, cleaningFeeId: null, laundryFeeId: null, skipped: true });
    }

    const door   = booking.doorNumber;
    const loads  = LAUNDRY_LOADS[door] || 1;
    const coDate = booking.checkOut;

    const [cleaningFee, laundryFee] = await Promise.all([
      new Transaction({
        type: 'expense',
        category: 'Cleaning Fee',
        amount: CLEANING_FEE,
        date: coDate,
        description: `Auto: cleaning fee for door ${door}`,
        bookingId: booking._id
      }).save(),
      new Transaction({
        type: 'expense',
        category: 'Laundry',
        amount: loads * LAUNDRY_RATE,
        date: coDate,
        description: `Auto: laundry for door${door} (${loads} load${loads > 1 ? 's' : ''} @₱200)`,
        bookingId: booking._id
      }).save()
    ]);

    res.json({ booking, cleaningFeeId: cleaningFee._id, laundryFeeId: laundryFee._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST undo-checkout — reverts to checked-in and deletes auto-posted fees
router.post('/:id/undo-checkout', async (req, res) => {
  try {
    const { cleaningFeeId, laundryFeeId } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    booking.status = 'checked-in';
    await booking.save();

    await Promise.all([
      cleaningFeeId ? Transaction.findByIdAndDelete(cleaningFeeId) : null,
      laundryFeeId  ? Transaction.findByIdAndDelete(laundryFeeId)  : null
    ]);

    res.json({ booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
