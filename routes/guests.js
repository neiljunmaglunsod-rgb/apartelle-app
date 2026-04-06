const express = require('express');
const router = express.Router();
const Guest = require('../models/Guest');
const Booking = require('../models/Booking');

// GET all guests
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) {
      query = { $or: [
        { name: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } }
      ]};
    }
    const guests = await Guest.find(query).sort({ name: 1 });
    res.json(guests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single guest with booking history
router.get('/:id', async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id);
    if (!guest) return res.status(404).json({ error: 'Guest not found' });
    const bookings = await Booking.find({ guestId: req.params.id }).sort({ checkIn: -1 });
    res.json({ guest, bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create guest
router.post('/', async (req, res) => {
  try {
    const guest = new Guest(req.body);
    await guest.save();
    res.status(201).json(guest);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update guest
router.put('/:id', async (req, res) => {
  try {
    const guest = await Guest.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!guest) return res.status(404).json({ error: 'Guest not found' });
    res.json(guest);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE guest
router.delete('/:id', async (req, res) => {
  try {
    await Guest.findByIdAndDelete(req.params.id);
    res.json({ message: 'Guest deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
