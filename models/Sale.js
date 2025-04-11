// models/Sale.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SaleItemSchema = new Schema({
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  type: { type: String, enum: ['sealed','prepared'], required: true },
  quantity: { type: Number, required: true },
  unit_price: { type: Number, required: true },
  portions: { type: Number },
  pricePerPortion: { type: Number },
  custom_price: { type: Boolean, default: false }
}, { _id: false });

const SaleGroupSchema = new Schema({
  name: { type: String, required: true },
  items: [SaleItemSchema]
}, { _id: false });

const SaleSchema = new Schema({
  itemGroups: [SaleGroupSchema],
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' }, // Campo opcional para el cliente
  total: { type: Number, required: true },
  client: { type: Schema.Types.ObjectId, ref: 'Client' },
  status: { type: String, enum: ['completed','pending_inventory_adjustment','cancelled'], default: 'completed' },
  employee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  clubId: { type: Schema.Types.ObjectId, ref: 'Tienda', required: true }  // <— asociar al club
}, { timestamps: { createdAt: 'created_at' } });

module.exports = mongoose.model('Sale', SaleSchema);


