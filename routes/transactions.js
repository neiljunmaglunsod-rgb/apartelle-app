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
