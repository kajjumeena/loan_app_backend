const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  totalDays: {
    type: Number,
    default: 100
  },
  dailyEMI: {
    type: Number,
    default: 0
  },
  dailyInterest: {
    type: Number,
    default: 0
  },
  interestRate: {
    type: Number,
    default: 20
  },
  totalPaid: {
    type: Number,
    default: 0
  },
  remainingBalance: {
    type: Number,
    default: 0
  },
  penaltyAmount: {
    type: Number,
    default: 0
  },
  // Application details
  applicantName: {
    type: String,
    required: true
  },
  applicantMobile: {
    type: String,
    required: true
  },
  applicantAddress: {
    type: String,
    required: true
  },
  applicantAadhaar: {
    type: String,
    required: true
  },
  applicantPan: {
    type: String,
    required: true
  },
  approvedAt: {
    type: Date,
    default: null
  },
  startDate: {
    type: Date,
    default: null
  },
  endDate: {
    type: Date,
    default: null
  },
  // Autopay/Subscription fields
  autopayEnabled: {
    type: Boolean,
    default: false
  },
  razorpaySubscriptionId: {
    type: String,
    default: null
  },
  razorpayCustomerId: {
    type: String,
    default: null
  },
  autopayStatus: {
    type: String,
    enum: ['none', 'pending', 'active', 'paused', 'cancelled'],
    default: 'none'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Calculate daily EMI before saving
// 20% of total amount as total interest, spread over totalDays
loanSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('amount') || this.isModified('totalDays')) {
    const totalInterest = this.amount * (this.interestRate / 100);
    const dailyPrincipal = this.amount / this.totalDays;
    this.dailyInterest = Math.ceil(totalInterest / this.totalDays);
    this.dailyEMI = Math.ceil(dailyPrincipal + this.dailyInterest);
    this.remainingBalance = this.amount + totalInterest;
  }
  next();
});

module.exports = mongoose.model('Loan', loanSchema);
