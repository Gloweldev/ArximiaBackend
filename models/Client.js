const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ClientSchema = new Schema({
  clubId: { type: Schema.Types.ObjectId, ref: 'Tienda', required: true },
  name: { type: String, required: true },
  email: { type: String, default: "" },
  phone: { type: String, default: "" },
  type: { type: String, enum: ['regular', 'wholesale', 'occasional'], default: 'regular' },
  total_spent: { type: Number, default: 0 },
  visitCount: { type: Number, default: 0 },
  last_purchase: { type: Date }, // Aseguramos que se guarde como fecha
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Client', ClientSchema);




