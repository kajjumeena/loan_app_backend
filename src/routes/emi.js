const express = require('express');
const EMI = require('../models/EMI');
const Loan = require('../models/Loan');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/emi/pending
// @desc    Get all pending EMIs for user
// @access  Private
router.get('/pending', protect, async (req, res) => {
  try {
    const pendingEMIs = await EMI.find({
      userId: req.user._id,
      status: { $in: ['pending', 'overdue'] }
    })
      .populate('loanId', 'amount applicantName')
      .sort({ dueDate: 1 });

    res.json(pendingEMIs);
  } catch (error) {
    console.error('Pending EMIs error:', error);
    res.status(500).json({ message: 'Error fetching pending EMIs' });
  }
});

// @route   GET /api/emi/today
// @desc    Get today's EMIs for user
// @access  Private
router.get('/today', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayEMIs = await EMI.find({
      userId: req.user._id,
      dueDate: { $gte: today, $lt: tomorrow }
    }).populate('loanId', 'amount applicantName');

    res.json(todayEMIs);
  } catch (error) {
    console.error('Today EMIs error:', error);
    res.status(500).json({ message: 'Error fetching today EMIs' });
  }
});

// @route   GET /api/emi/my-requested
// @desc    Get user's pending payment requests
// @access  Private
router.get('/my-requested', protect, async (req, res) => {
  try {
    const emis = await EMI.find({
      userId: req.user._id,
      paymentRequested: true,
      status: { $ne: 'paid' }
    })
      .populate('loanId', 'amount applicantName')
      .sort({ paymentRequestedAt: -1 });

    res.json(emis);
  } catch (error) {
    console.error('My requested EMIs error:', error);
    res.status(500).json({ message: 'Error fetching requested EMIs' });
  }
});

// @route   GET /api/emi/my-recently-completed
// @desc    Get user's recently completed EMI requests
// @access  Private
router.get('/my-recently-completed', protect, async (req, res) => {
  try {
    const emis = await EMI.find({
      userId: req.user._id,
      paidViaRequest: true,
      status: 'paid'
    })
      .populate('loanId', 'amount applicantName')
      .sort({ paidAt: -1 })
      .limit(20);

    res.json(emis);
  } catch (error) {
    console.error('My recently completed EMIs error:', error);
    res.status(500).json({ message: 'Error fetching recently completed EMIs' });
  }
});

// @route   GET /api/emi/loan/:loanId
// @desc    Get EMIs for a specific loan with pagination
// @access  Private
router.get('/loan/:loanId', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const loanId = req.params.loanId;
    const loan = await Loan.findById(loanId);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Check ownership or admin
    if (loan.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    let query = { loanId };
    if (status) query.status = status;

    const emis = await EMI.find(query)
      .sort({ dayNumber: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await EMI.countDocuments(query);

    res.json({
      emis,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Loan EMIs error:', error);
    res.status(500).json({ message: 'Error fetching loan EMIs' });
  }
});

// @route   GET /api/emi/:id
// @desc    Get single EMI details
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const emi = await EMI.findById(req.params.id)
      .populate('loanId', 'amount applicantName status');

    if (!emi) {
      return res.status(404).json({ message: 'EMI not found' });
    }

    // Check ownership
    if (emi.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(emi);
  } catch (error) {
    console.error('Get EMI error:', error);
    res.status(500).json({ message: 'Error fetching EMI details' });
  }
});

// @route   POST /api/emi/:id/request-payment
// @desc    User requests payment verification for an EMI (after paying via UPI)
// @access  Private
router.post('/:id/request-payment', protect, async (req, res) => {
  try {
    const emi = await EMI.findById(req.params.id);
    if (!emi) return res.status(404).json({ message: 'EMI not found' });

    // Check ownership
    if (emi.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (emi.status === 'paid') {
      return res.status(400).json({ message: 'EMI is already paid' });
    }

    if (emi.paymentRequested) {
      return res.status(400).json({ message: 'Payment verification already requested' });
    }

    emi.paymentRequested = true;
    emi.paymentRequestedAt = new Date();
    emi.requestCanceled = false;
    emi.requestCanceledAt = null;
    await emi.save();

    const loan = await Loan.findById(emi.loanId);
    const emiDate = emi.dueDate ? new Date(emi.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const dayLabel = `Day ${emi.dayNumber}${emiDate ? ` (${emiDate})` : ''}`;

    // Create admin notification
    const adminNotif = await Notification.create({
      type: 'emi_payment_request',
      forAdmin: true,
      userId: emi.userId,
      loanId: emi.loanId,
      emiId: emi._id,
      title: 'EMI Payment Request',
      body: `${loan?.applicantName || 'User'} claims to have paid ${dayLabel} EMI of ₹${emi.totalAmount}. Please verify.`,
    });

    // Create user confirmation notification
    const userNotif = await Notification.create({
      type: 'emi_payment_request',
      forAdmin: false,
      userId: emi.userId,
      loanId: emi.loanId,
      emiId: emi._id,
      title: 'Payment Request Sent',
      body: `Your payment request for ${dayLabel} EMI of ₹${emi.totalAmount} has been sent to admin for verification.`,
    });

    // Send push notifications via socket
    const { emitNotification } = require('../socket');
    await emitNotification(adminNotif);
    await emitNotification(userNotif);

    res.json({ message: 'Payment request sent to admin', emi });
  } catch (error) {
    console.error('Request payment error:', error);
    res.status(500).json({ message: 'Error requesting payment verification' });
  }
});

module.exports = router;
