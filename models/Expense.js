// models/Expense.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ExpenseSchema = new Schema({
  clubId: { type: Schema.Types.ObjectId, ref: 'Tienda', required: true },
  product: { type: Schema.Types.ObjectId, ref: 'Product' }, // Opcional: si el gasto es por compra de producto
  category: { type: String }, // Por ejemplo: 'purchase' o 'operational'
  amount: { type: Number, required: true },
  description: { type: String },
  date: { type: Date, default: Date.now },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true }
});

module.exports = mongoose.model('Expense', ExpenseSchema);
