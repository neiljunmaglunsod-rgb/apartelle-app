const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');

// GET all transactions with optional filters
router.get('/', async (req, res) => {
  try {
    const { type, month, year } = req.query;
    let query = {};
    if (type) query.type = type;
    if (month && year) {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      query.date = { $gte: start, $lt: end };
    } else if (year) {
      const start = new Date(year, 0, 1);
      const end = new Date(parseInt(year) + 1, 0, 1);
      query.date = { $gte: start, $lt: end };
    }
    const transactions = await Transaction.find(query).sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET monthly summary report
router.get('/report/monthly', async (req, res) => {
  try {
    const { year } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);

    const data = await Transaction.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { month: { $month: '$date' }, type: '$type' },
          total: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.month': 1 } }
    ]);

    // Build 12-month summary
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      income: 0,
      expense: 0,
      net: 0
    }));

    data.forEach(({ _id, total }) => {
      const m = months[_id.month - 1];
      if (_id.type === 'income') m.income = total;
      else m.expense = total;
    });
    months.forEach(m => { m.net = m.income - m.expense; });

    const totals = months.reduce((acc, m) => ({
      income: acc.income + m.income,
      expense: acc.expense + m.expense,
      net: acc.net + m.net
    }), { income: 0, expense: 0, net: 0 });

    res.json({ year: y, months, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET income by door (for a year)
router.get('/report/by-door', async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const { year } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y + 1, 0, 1));

    const data = await Booking.aggregate([
      { $match: { status: { $nin: ['cancelled'] }, checkIn: { $gte: start, $lt: end } } },
      { $group: { _id: '$doorNumber', totalIncome: { $sum: '$totalPrice' }, bookingCount: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET income by booking source (for a year)
router.get('/report/by-source', async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const { year } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y + 1, 0, 1));

    const data = await Booking.aggregate([
      { $match: { status: { $nin: ['cancelled'] }, checkIn: { $gte: start, $lt: end } } },
      { $group: { _id: '$source', totalIncome: { $sum: '$totalPrice' }, bookingCount: { $sum: 1 } } },
      { $sort: { totalIncome: -1 } }
    ]);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET occupancy rate per door (for a year)
router.get('/report/occupancy', async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    const { year } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y + 1, 0, 1));
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const totalDays = isLeap ? 366 : 365;

    const data = await Booking.aggregate([
      { $match: { status: { $nin: ['cancelled'] }, checkIn: { $gte: start, $lt: end } } },
      { $group: { _id: '$doorNumber', occupiedDays: { $sum: '$nights' } } },
      { $sort: { _id: 1 } }
    ]);

    const result = [1, 2, 3, 4].map(door => {
      const found = data.find(d => d._id === door);
      const occupiedDays = found ? found.occupiedDays : 0;
      return { door, occupiedDays, totalDays, rate: parseFloat(((occupiedDays / totalDays) * 100).toFixed(1)) };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET last 6 months income vs expense
router.get('/report/last6months', async (req, res) => {
  try {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
    }

    const start = new Date(Date.UTC(months[0].year, months[0].month - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const data = await Transaction.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' }, total: { $sum: '$amount' } } }
    ]);

    const result = months.map(({ year, month }) => {
      const inc = data.find(d => d._id.year === year && d._id.month === month && d._id.type === 'income');
      const exp = data.find(d => d._id.year === year && d._id.month === month && d._id.type === 'expense');
      const income = inc ? inc.total : 0;
      const expense = exp ? exp.total : 0;
      return { label: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month-1]} ${year}`, income, expense, net: income - expense };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET staff fees summary (auto-posted cleaning + laundry fees)
router.get('/report/staff-fees', async (req, res) => {
  try {
    const { door, from, to } = req.query;

    const matchStage = {
      bookingId: { $ne: null },
      description: { $regex: /^Auto:/ }
    };
    if (from || to) {
      matchStage.date = {};
      if (from) matchStage.date.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setDate(toDate.getDate() + 1);
        matchStage.date.$lte = toDate;
      }
    }

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'bookings',
          localField: 'bookingId',
          foreignField: '_id',
          as: 'booking'
        }
      },
      { $unwind: { path: '$booking', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          doorNumber: '$booking.doorNumber',
          guestName: '$booking.guestName'
        }
      },
      ...(door ? [{ $match: { doorNumber: parseInt(door) } }] : []),
      { $sort: { date: -1 } }
    ];

    const fees = await Transaction.aggregate(pipeline);

    // Summary totals
    let cleaningTotal = 0, laundryTotal = 0;
    fees.forEach(f => {
      if (f.category === 'Cleaning Fee') cleaningTotal += f.amount;
      else if (f.category === 'Laundry')  laundryTotal  += f.amount;
    });

    // Per-door breakdown
    const doorMap = {};
    [1, 2, 3, 4].forEach(d => { doorMap[d] = { door: d, cleaning: 0, laundry: 0, total: 0, checkoutIds: new Set() }; });
    fees.forEach(f => {
      const d = f.doorNumber;
      if (!doorMap[d]) return;
      if (f.category === 'Cleaning Fee') doorMap[d].cleaning += f.amount;
      else if (f.category === 'Laundry') doorMap[d].laundry  += f.amount;
      doorMap[d].total += f.amount;
      if (f.bookingId) doorMap[d].checkoutIds.add(f.bookingId.toString());
    });

    const byDoor = [1, 2, 3, 4].map(d => ({
      door: d,
      cleaning: doorMap[d].cleaning,
      laundry:  doorMap[d].laundry,
      total:    doorMap[d].total,
      checkouts: doorMap[d].checkoutIds.size
    }));

    res.json({
      summary: { totalFees: cleaningTotal + laundryTotal, cleaningTotal, laundryTotal },
      byDoor,
      log: fees.map(f => ({
        _id:        f._id,
        date:       f.date,
        category:   f.category,
        amount:     f.amount,
        description: f.description,
        doorNumber: f.doorNumber,
        guestName:  f.guestName,
        bookingId:  f.bookingId
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET category breakdown for a month
router.get('/report/categories', async (req, res) => {
  try {
    const { month, year } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    const data = await Transaction.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      { $group: { _id: { type: '$type', category: '$category' }, total: { $sum: '$amount' } } },
      { $sort: { total: -1 } }
    ]);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create transaction
router.post('/', async (req, res) => {
  try {
    const transaction = new Transaction(req.body);
    await transaction.save();
    res.status(201).json(transaction);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update transaction
router.put('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    res.json(transaction);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE transaction
router.delete('/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
