// models/Inventory.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const InventorySchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  clubId: { type: Schema.Types.ObjectId, ref: 'Tienda', required: true },
  // Para productos sellados (unidades completas)
  sealed: { type: Number, default: 0 },
  // Para productos de preparación
  preparation: {
    units: { type: Number, default: 0 },           // Número de envases asignados para preparaciones
    portionsPerUnit: { type: Number, default: 0 },   // Porciones por envase (definido en catálogo)
    currentPortions: { type: Number, default: 0 },   // Porciones disponibles en el envase actual
    portionPrice: { type: Number },                  // Precio por porción
    portionSize: { type: String },                   // Tamaño de la porción (ej. "25g", "150ml")
  },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Inventory', InventorySchema);

