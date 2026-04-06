const mongoose = require('mongoose');

const guestSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  contact: { type: String, trim: true },
  address: { type: String, trim: true },
  notes: { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model('Guest', guestSchema);
