const express = require('express');
const Loan = require('../models/Loan');
const EMI = require('../models/EMI');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { getIO } = require('../socket');
const { protect } = require('../middleware/auth');
const { getLoanStats } = require('../services/emiCalculator');
const { sendPushNotification } = require('../utils/pushNotifications');

const router = express.Router();

// @route   POST /api/loan/apply
// @desc    Apply for a new loan
// @access  Private
router.post('/apply', protect, async (req, res) => {
  try {
    const { amount, name, mobile, address, aadhaarNumber, panNumber, addressIndex } = req.body;

    // Validation
    if (!amount || !name || !mobile || !address || !aadhaarNumber || !panNumber) {
      return res.status(400).json({
        message: 'All fields are required: amount, name, mobile, address, aadhaarNumber, panNumber'
      });
    }

    const amountNum = parseInt(amount);
    if (isNaN(amountNum) || amountNum < 1000 || amountNum > 100000) {
      return res.status(400).json({
        message: 'Loan amount must be between ₹1,000 and ₹1,00,000'
      });
    }

    // Check if user has a pending loan application
    const existingPending = await Loan.findOne({
      userId: req.user._id,
      status: 'pending'
    });

    if (existingPending) {
      return res.status(400).json({
        message: 'You already have a pending loan application'
      });
    }

    // Create loan application - default 100 days, admin can edit when approving
    const totalDays = 100;

    const loan = new Loan({
      userId: req.user._id,
      amount: amountNum,
      totalDays,
      applicantName: name,
      applicantMobile: mobile,
      applicantAddress: address,
      applicantAadhaar: aadhaarNumber,
      applicantPan: panNumber
    });

    await loan.save();

    const notif = await Notification.create({
      type: 'loan_request',
      forAdmin: true,
      loanId: loan._id,
      userId: req.user._id,
      title: 'New Loan Request',
      body: `${name} applied for ₹${amountNum.toLocaleString('en-IN')}`,
    });

    // Use centralized notification emitter for both Socket and Push
    const { emitNotification } = require('../socket');
    await emitNotification(notif);

    // Update user profile and add address to saved addresses
    const userDoc = await User.findById(req.user._id);
    if (!userDoc.name) userDoc.name = name;
    if (!userDoc.aadhaarNumber) userDoc.aadhaarNumber = aadhaarNumber;
    if (!userDoc.panNumber) userDoc.panNumber = panNumber;
    userDoc.address = address;
    if (!userDoc.addresses) userDoc.addresses = [];
    if (address && !userDoc.addresses.includes(address)) {
      userDoc.addresses.push(address);
    }
    await userDoc.save();

    res.status(201).json({
      message: 'Loan application submitted successfully',
      loan: {
        id: loan._id,
        amount: loan.amount,
        status: loan.status,
        dailyEMI: loan.dailyEMI,
        createdAt: loan.createdAt
      }
    });
  } catch (error) {
    console.error('Loan apply error:', error);
    res.status(500).json({ message: 'Error submitting loan application' });
  }
});

// @route   GET /api/loan/my-loans
// @desc    Get all loans for logged in user
// @access  Private
router.get('/my-loans', protect, async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.user._id })
      .sort({ createdAt: -1 });

    res.json(loans);
  } catch (error) {
    console.error('My loans error:', error);
    res.status(500).json({ message: 'Error fetching loans' });
  }
});

// @route   GET /api/loan/:id
// @desc    Get loan details with EMI stats
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Check if user owns this loan or is admin
    if (loan.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get EMI stats if loan is approved
    let stats = null;
    let emis = [];

    if (loan.status === 'approved' || loan.status === 'completed') {
      stats = await getLoanStats(loan._id);
      emis = await EMI.find({ loanId: loan._id }).sort({ dayNumber: 1 });
    }

    // For admin: include applicant's document images for verification
    let loanData = loan.toObject();
    if (req.user.role === 'admin') {
      const applicant = await User.findById(loan.userId).select('aadhaarImage panImage');
      if (applicant) {
        loanData.aadhaarImage = applicant.aadhaarImage || '';
        loanData.panImage = applicant.panImage || '';
      }
    }

    res.json({
      loan: loanData,
      stats,
      emis
    });
  } catch (error) {
    console.error('Get loan error:', error);
    res.status(500).json({ message: 'Error fetching loan details' });
  }
});

module.exports = router;
