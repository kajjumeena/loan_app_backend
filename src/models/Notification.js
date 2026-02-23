const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['loan_request', 'loan_approved', 'loan_rejected', 'emi_paid', 'emi_pending_today', 'emi_overdue'],
    required: true,
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  forAdmin: { type: Boolean, default: false },
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
  emiId: { type: mongoose.Schema.Types.ObjectId, ref: 'EMI' },
  title: { type: String },
  body: { type: String },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ userId: 1, forAdmin: 1, createdAt: -1 });
module.exports = mongoose.model('Notification', notificationSchema);
