// models/PasswordResetToken.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PasswordResetTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true }
});

module.exports = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);
