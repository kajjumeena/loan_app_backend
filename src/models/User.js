const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  mobile: {
    type: String,
    trim: true,
    default: ''
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  address: {
    type: String,
    trim: true,
    default: ''
  },
  addresses: [{
    type: String,
    trim: true
  }],
  aadhaarNumber: {
    type: String,
    trim: true,
    default: ''
  },
  panNumber: {
    type: String,
    trim: true,
    default: ''
  },
  aadhaarImage: {
    type: String,
    trim: true,
    default: ''
  },
  panImage: {
    type: String,
    trim: true,
    default: ''
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  otp: {
    type: String,
    default: null
  },
  otpExpiry: {
    type: Date,
    default: null
  },
  pushToken: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);
