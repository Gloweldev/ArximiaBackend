const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ReportTemplateSchema = new Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  format: { type: String, enum: ['pdf', 'excel'], required: true },
  sections: [{
    name: String,
    type: String,
    showInPDF: Boolean,
    showInExcel: Boolean,
    order: Number
  }],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ReportTemplate', ReportTemplateSchema);
