const mongoose = require('mongoose');

const emiSchema = new mongoose.Schema({
  loanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Loan',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  dayNumber: {
    type: Number,
    required: true
  },
  principalAmount: {
    type: Number,
    required: true
  },
  interestAmount: {
    type: Number,
    default: 0
  },
  penaltyAmount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'overdue'],
    default: 'pending'
  },
  razorpayOrderId: {
    type: String,
    default: null
  },
  razorpayPaymentId: {
    type: String,
    default: null
  },
  paymentRequested: {
    type: Boolean,
    default: false
  },
  paymentRequestedAt: {
    type: Date,
    default: null
  },
  paidAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for efficient queries
emiSchema.index({ loanId: 1, dayNumber: 1 });
emiSchema.index({ userId: 1, status: 1 });
emiSchema.index({ dueDate: 1, status: 1 });

module.exports = mongoose.model('EMI', emiSchema);
