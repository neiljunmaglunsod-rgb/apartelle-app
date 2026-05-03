const mongoose = require('mongoose');

const ROOM_CONFIG = {
  1: { rate: 2700, maxGuests: 6 },
  2: { rate: 2400, maxGuests: 5 },
  3: { rate: 1600, maxGuests: 3 },
  4: { rate: 2800, maxGuests: 8 }
};
const EXTRA_BED_CHARGE = 250;

const bookingSchema = new mongoose.Schema({
  guestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guest', required: true },
  guestName: { type: String, required: true },
  guestContact: { type: String },
  doorNumber: { type: Number, required: true, enum: [1, 2, 3, 4] },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  guestCount: { type: Number, required: true, min: 1 },
  nights: { type: Number },
  baseRate: { type: Number },
  extraBeds: { type: Number, default: 0 },
  extraCharge: { type: Number, default: 0 },
  totalPrice: { type: Number },
  source: { type: String, enum: ['Airbnb', 'Walk-in', 'Facebook', 'Other'], default: 'Walk-in' },
  status: { type: String, enum: ['confirmed', 'checked-in', 'checked-out', 'cancelled'], default: 'confirmed' },
  notes: { type: String, trim: true },
  amountPaid: { type: Number, default: 0 }
}, { timestamps: true });

bookingSchema.pre('save', async function () {
  const config = ROOM_CONFIG[this.doorNumber];
  if (!config) throw new Error('Invalid door number');

  const msPerDay = 1000 * 60 * 60 * 24;
  this.nights = Math.round((new Date(this.checkOut) - new Date(this.checkIn)) / msPerDay);
  if (this.nights < 1) throw new Error('Check-out must be after check-in');

  const Settings = require('./Settings');
  const saved = await Settings.findOne({ key: `door_${this.doorNumber}_rate` });
  const rate = saved ? Number(saved.value) : config.rate;

  this.baseRate = rate;
  this.extraBeds = Math.max(0, this.guestCount - config.maxGuests);
  this.extraCharge = this.extraBeds * EXTRA_BED_CHARGE * this.nights;
  this.totalPrice = (rate * this.nights) + this.extraCharge;
});

module.exports = mongoose.model('Booking', bookingSchema);
module.exports.ROOM_CONFIG = ROOM_CONFIG;
module.exports.EXTRA_BED_CHARGE = EXTRA_BED_CHARGE;
