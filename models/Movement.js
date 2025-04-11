// models/Movement.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MovementSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  clubId: { type: Schema.Types.ObjectId, ref: 'Tienda', required: true },
  type: { type: String, enum: ['venta', 'uso', 'compra', 'ajuste'], required: true },
  quantity: { type: Number, required: true },
  unit: { type: String, enum: ['sealed', 'portion'], required: true },
  description: { type: String },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Movement', MovementSchema);
