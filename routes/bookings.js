const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const Transaction = require('../models/Transaction');

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
router.get('/price-preview', (req, res) => {
  const { door, checkIn, checkOut, guestCount } = req.query;
  const ROOM_CONFIG = { 1: { rate: 2700, maxGuests: 6 }, 2: { rate: 2400, maxGuests: 5 }, 3: { rate: 1600, maxGuests: 3 }, 4: { rate: 2800, maxGuests: 8 } };
  const config = ROOM_CONFIG[parseInt(door)];
  if (!config) return res.status(400).json({ error: 'Invalid door' });

  const msPerDay = 1000 * 60 * 60 * 24;
  const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / msPerDay);
  if (nights < 1) return res.status(400).json({ error: 'Invalid dates' });

  const gc = parseInt(guestCount);
  const extraBeds = Math.max(0, gc - config.maxGuests);
  const extraCharge = extraBeds * 250 * nights;
  const totalPrice = config.rate * nights + extraCharge;

  res.json({ nights, baseRate: config.rate, extraBeds, extraCharge, totalPrice, maxGuests: config.maxGuests });
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

module.exports = router;
