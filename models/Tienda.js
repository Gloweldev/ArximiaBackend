//Tienda.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Sub-esquema para horarios
const HorarioSchema = new Schema({
  open: { type: String, default: "00:00" },
  close: { type: String, default: "00:00" },
}, { _id: false });

// Esquema para cada día
const DayScheduleSchema = new Schema({
  closed: { type: Boolean, default: false },
  ranges: { type: [HorarioSchema], default: [{ open: "00:00", close: "00:00" }] },
}, { _id: false });

const TiendaSchema = new Schema({
  duenoId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  nombre: { type: String, required: true },
  direccion: { type: String },
  metaMensual: { type: Number, default: 0 },
  schedule: {
    monday:    { type: DayScheduleSchema, default: () => ({}) },
    tuesday:   { type: DayScheduleSchema, default: () => ({}) },
    wednesday: { type: DayScheduleSchema, default: () => ({}) },
    thursday:  { type: DayScheduleSchema, default: () => ({}) },
    friday:    { type: DayScheduleSchema, default: () => ({}) },
    saturday:  { type: DayScheduleSchema, default: () => ({}) },
    sunday:    { type: DayScheduleSchema, default: () => ({}) },
  },
  paymentMethods: {
    type: [String],
    enum: ['cash', 'card', 'transfer'],
    default: [],
  },
  contact: {
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
  },
  image: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});


module.exports = mongoose.model('Tienda', TiendaSchema);

