// models/Product.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ProductSchema = new Schema({
  type: { type: String, enum: ['sealed', 'prepared', 'both'], required: true },
  name: { type: String, required: true },
  brand: { type: String },
  category: { type: String, required: true },
  // Campos para productos preparados
  portions: { type: Number },          // Número de porciones (si aplica)
  portionSize: { type: String },         // Tamaño de la porción (si aplica)
  portionPrice: { type: Number },        // Precio por porción (si aplica)
  // Campos para productos sellados (y ambos)
  salePrice: { type: Number },           // Precio de venta (para sellado o ambos)
  purchasePrice: { type: Number, required: true }, // Precio de compra (común)
  flavor: { type: String },              // Campo opcional, por ejemplo, para sabores
  imageUrl: { type: String },            // URL de la imagen del producto
  clubId: { type: Schema.Types.ObjectId, ref: 'Tienda', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  archived: { type: Boolean, default: false }, // Campo para archivar el producto
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', ProductSchema);
