const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Schema = mongoose.Schema;

const EmployeeSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  role: { type: String, required: true },
  club: { type: Schema.Types.ObjectId, ref: 'Tienda', required: true },
  avatar: { type: String },
  tempPassword: { type: String, required: true },
  plainTempPassword: { type: String },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true }, // NUEVO: controla la activación/desactivación del empleado
  lastAccess: { type: Date, default: null },
  passwordChanged: { type: Boolean, default: false },
  salesGoal: { type: Number, default: 1000 }, // Meta por defecto, por ejemplo $10,000
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

EmployeeSchema.pre('save', async function (next) {
  if (this.isModified('tempPassword')) {
    const salt = await bcrypt.genSalt(10);
    this.tempPassword = await bcrypt.hash(this.tempPassword, salt);
  }
  next();
});

EmployeeSchema.methods.comparePassword = async function (plaintext) {
  return bcrypt.compare(plaintext, this.tempPassword);
};

module.exports = mongoose.model('Employee', EmployeeSchema);
