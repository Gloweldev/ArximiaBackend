// models/Payment.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PaymentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  invoiceId: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['paid', 'failed'], default: 'paid' },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payment', PaymentSchema);
