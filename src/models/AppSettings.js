const mongoose = require('mongoose');

const DEFAULTS = {
  upiId: '9530305519-9@axl',
  upiNumber: '9530305519',
  supportNumber: '9672030409',
  helpText: '',
};

const appSettingsSchema = new mongoose.Schema({
  qrImageBase64: { type: String, default: '' },
  upiId: { type: String, trim: true, default: DEFAULTS.upiId },
  upiNumber: { type: String, trim: true, default: DEFAULTS.upiNumber },
  supportNumber: { type: String, trim: true, default: DEFAULTS.supportNumber },
  helpText: { type: String, default: DEFAULTS.helpText },
}, { timestamps: true });

// Single document - use findOneAndUpdate with upsert
module.exports = mongoose.model('AppSettings', appSettingsSchema);
module.exports.DEFAULTS = DEFAULTS;
