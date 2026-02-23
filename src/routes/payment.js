const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const EMI = require('../models/EMI');
const Loan = require('../models/Loan');
const Notification = require('../models/Notification');
const { getIO } = require('../socket');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { sendPushNotification } = require('../utils/pushNotifications');

const router = express.Router();

// Check if we have valid Razorpay keys
const hasValidRazorpayKeys = process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET &&
  process.env.RAZORPAY_KEY_ID.startsWith('rzp_');

// Initialize Razorpay only if valid keys exist
let razorpay = null;
if (hasValidRazorpayKeys) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

// @route   POST /api/payment/simulate
// @desc    Simulate payment for testing (no Razorpay required)
// @access  Private
router.post('/simulate', protect, async (req, res) => {
  try {
    const { emiId } = req.body;

    if (!emiId) {
      return res.status(400).json({ message: 'EMI ID is required' });
    }

    const emi = await EMI.findById(emiId);

    if (!emi) {
      return res.status(404).json({ message: 'EMI not found' });
    }

    // Check ownership
    if (emi.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if already paid
    if (emi.status === 'paid') {
      return res.status(400).json({ message: 'EMI is already paid' });
    }

    // Simulate successful payment
    emi.status = 'paid';
    emi.razorpayPaymentId = `sim_${Date.now()}`;
    emi.paidAt = new Date();
    await emi.save();

    // Update loan totals
    const loan = await Loan.findById(emi.loanId);
    if (loan) {
      loan.totalPaid += emi.totalAmount;
      loan.remainingBalance -= (emi.principalAmount + emi.interestAmount);

      // Check if loan is completed
      const pendingEMIs = await EMI.countDocuments({
        loanId: loan._id,
        status: { $ne: 'paid' }
      });

      if (pendingEMIs === 0) {
        loan.status = 'completed';
      }

      await loan.save();

      const notif = await Notification.create({
        type: 'emi_paid',
        forAdmin: true,
        userId: emi.userId,
        loanId: emi.loanId,
        emiId: emi._id,
        title: 'EMI Paid (Simulated)',
        body: `Day ${emi.dayNumber} EMI - ₹${emi.totalAmount} paid by ${req.user.name || 'User'}`,
      });

      const { emitNotification } = require('../socket');
      await emitNotification(notif);
    }

    res.json({
      message: 'Payment successful (simulated)',
      emi: {
        id: emi._id,
        status: emi.status,
        paidAt: emi.paidAt,
        amount: emi.totalAmount
      }
    });
  } catch (error) {
    console.error('Simulate payment error:', error);
    res.status(500).json({ message: 'Error processing simulated payment' });
  }
});

// @route   POST /api/payment/create-order
// @desc    Create Razorpay order for EMI payment
// @access  Private
router.post('/create-order', protect, async (req, res) => {
  try {
    const { emiId } = req.body;

    console.log('=== Create Order Request ===');
    console.log('EMI ID:', emiId);
    console.log('Razorpay configured:', !!razorpay);

    if (!emiId) {
      return res.status(400).json({ message: 'EMI ID is required' });
    }

    const emi = await EMI.findById(emiId);

    if (!emi) {
      console.log('ERROR: EMI not found');
      return res.status(404).json({ message: 'EMI not found' });
    }

    console.log('EMI found:', emi._id, 'Amount:', emi.totalAmount, 'Status:', emi.status);

    // Check ownership
    if (emi.userId.toString() !== req.user._id.toString()) {
      console.log('ERROR: Access denied - user mismatch');
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if already paid
    if (emi.status === 'paid') {
      console.log('ERROR: EMI already paid');
      return res.status(400).json({ message: 'EMI is already paid' });
    }

    // If no valid Razorpay keys, return simulation mode indicator
    if (!razorpay) {
      console.log('Razorpay not configured - returning simulation mode');
      return res.json({
        simulationMode: true,
        emiId: emi._id,
        amount: emi.totalAmount * 100,
        currency: 'INR',
        message: 'Razorpay not configured. Use /api/payment/simulate endpoint.'
      });
    }

    // Create Razorpay order
    const options = {
      amount: Math.round(emi.totalAmount * 100), // Amount in paise
      currency: 'INR',
      receipt: `emi_${emi._id}`,
      notes: {
        emiId: emi._id.toString(),
        userId: req.user._id.toString(),
        loanId: emi.loanId.toString()
      }
    };
    // Use custom config to show UPI apps (PhonePe, GPay, Paytm) - set RAZORPAY_CHECKOUT_CONFIG_ID in .env
    if (process.env.RAZORPAY_CHECKOUT_CONFIG_ID) {
      options.checkout_config_id = process.env.RAZORPAY_CHECKOUT_CONFIG_ID;
    }

    console.log('Creating Razorpay order with options:', options);
    const order = await razorpay.orders.create(options);
    console.log('Razorpay order created:', order.id);

    // Store order ID in EMI
    emi.razorpayOrderId = order.id;
    await emi.save();

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      emiId: emi._id
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Error creating payment order' });
  }
});

// @route   POST /api/payment/verify
// @desc    Verify Razorpay payment
// @access  Private
router.post('/verify', protect, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, emiId } = req.body;

    console.log('=== Payment Verification Request ===');
    console.log('Order ID:', razorpay_order_id);
    console.log('Payment ID:', razorpay_payment_id);
    console.log('Signature:', razorpay_signature);
    console.log('EMI ID:', emiId);

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !emiId) {
      console.log('ERROR: Missing payment details');
      return res.status(400).json({ message: 'Missing payment details' });
    }

    // Verify Razorpay signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    console.log('Expected signature:', expectedSignature);
    console.log('Received signature:', razorpay_signature);

    const isAuthentic = expectedSignature === razorpay_signature;

    if (!isAuthentic) {
      console.log('ERROR: Signature mismatch - verification failed');
      return res.status(400).json({ message: 'Payment verification failed' });
    }

    console.log('Signature verified successfully');

    // Update EMI status
    const emi = await EMI.findById(emiId);

    if (!emi) {
      console.log('ERROR: EMI not found');
      return res.status(404).json({ message: 'EMI not found' });
    }

    emi.status = 'paid';
    emi.razorpayPaymentId = razorpay_payment_id;
    emi.paidAt = new Date();
    await emi.save();

    // Update loan totals
    const loan = await Loan.findById(emi.loanId);
    if (loan) {
      loan.totalPaid += emi.totalAmount;
      loan.remainingBalance -= (emi.principalAmount + emi.interestAmount);

      // Check if loan is completed
      const pendingEMIs = await EMI.countDocuments({
        loanId: loan._id,
        status: { $ne: 'paid' }
      });

      if (pendingEMIs === 0) {
        loan.status = 'completed';
      }

      await loan.save();

      const notif = await Notification.create({
        type: 'emi_paid',
        forAdmin: true,
        userId: emi.userId,
        loanId: emi.loanId,
        emiId: emi._id,
        title: 'EMI Paid',
        body: `Day ${emi.dayNumber} EMI - ₹${emi.totalAmount} paid by ${req.user.name || 'User'}`,
      });

      const { emitNotification } = require('../socket');
      await emitNotification(notif);
    }

    console.log('Payment SUCCESS for EMI:', emiId);
    res.json({
      message: 'Payment successful',
      emi: {
        id: emi._id,
        status: emi.status,
        paidAt: emi.paidAt,
        amount: emi.totalAmount
      }
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ message: 'Error verifying payment' });
  }
});

// @route   POST /api/payment/pay-multiple
// @desc    Pay multiple EMIs at once
// @access  Private
router.post('/pay-multiple', protect, async (req, res) => {
  try {
    const { emiIds } = req.body;

    if (!emiIds || !Array.isArray(emiIds) || emiIds.length === 0) {
      return res.status(400).json({ message: 'EMI IDs array is required' });
    }

    // Get all EMIs
    const emis = await EMI.find({
      _id: { $in: emiIds },
      userId: req.user._id,
      status: { $ne: 'paid' }
    });

    if (emis.length === 0) {
      return res.status(400).json({ message: 'No pending EMIs found' });
    }

    // Calculate total amount
    const totalAmount = emis.reduce((sum, emi) => sum + emi.totalAmount, 0);

    // Create Razorpay order
    const options = {
      amount: Math.round(totalAmount * 100),
      currency: 'INR',
      receipt: `multi_emi_${Date.now()}`,
      notes: {
        emiIds: emiIds.join(','),
        userId: req.user._id.toString()
      }
    };

    const order = await razorpay.orders.create(options);

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      emiIds,
      emiCount: emis.length
    });
  } catch (error) {
    console.error('Pay multiple error:', error);
    res.status(500).json({ message: 'Error creating payment order' });
  }
});

// @route   POST /api/payment/setup-autopay
// @desc    Setup autopay/subscription for a loan
// @access  Private
router.post('/setup-autopay', protect, async (req, res) => {
  try {
    const { loanId } = req.body;

    console.log('=== Setup Autopay Request ===');
    console.log('Loan ID:', loanId);
    console.log('User:', req.user._id);

    if (!loanId) {
      return res.status(400).json({ message: 'Loan ID is required' });
    }

    if (!razorpay) {
      return res.status(400).json({ message: 'Razorpay not configured' });
    }

    const loan = await Loan.findById(loanId);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Check ownership
    if (loan.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if autopay is already active
    if (loan.autopayEnabled && loan.autopayStatus === 'active') {
      return res.status(400).json({ message: 'Autopay is already active for this loan' });
    }

    // Create or get Razorpay customer
    let customerId = loan.razorpayCustomerId;

    if (!customerId) {
      const customer = await razorpay.customers.create({
        name: loan.applicantName,
        contact: loan.applicantMobile,
        notes: {
          loanId: loan._id.toString(),
          userId: req.user._id.toString()
        }
      });
      customerId = customer.id;
      loan.razorpayCustomerId = customerId;
      console.log('Created Razorpay customer:', customerId);
    }

    // Calculate remaining EMIs
    const pendingEMIs = await EMI.countDocuments({
      loanId: loan._id,
      status: { $ne: 'paid' }
    });

    if (pendingEMIs === 0) {
      return res.status(400).json({ message: 'No pending EMIs for autopay' });
    }

    // Create a subscription plan for this loan's daily EMI
    const planId = `plan_loan_${loan._id}`;
    let plan;

    try {
      // Try to fetch existing plan
      plan = await razorpay.plans.fetch(planId);
      console.log('Found existing plan:', planId);
    } catch (e) {
      // Create new plan if not exists
      plan = await razorpay.plans.create({
        period: 'daily',
        interval: 7, // Razorpay minimum: charges every 7 days
        item: {
          name: `Loan EMI - ${loan.applicantName}`,
          amount: Math.round(loan.dailyEMI * 7 * 100), // 7 days of EMI in paise
          currency: 'INR',
          description: `Weekly EMI (7 days) for loan ${loan._id}`
        },
        notes: {
          loanId: loan._id.toString()
        }
      });
      console.log('Created new plan:', plan.id);
    }

    // Create subscription - charges every 7 days, each charge = 7 EMIs
    const billingCycles = Math.ceil(pendingEMIs / 7);
    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_id: customerId,
      total_count: billingCycles,
      quantity: 1,
      customer_notify: 1,
      notes: {
        loanId: loan._id.toString(),
        userId: req.user._id.toString()
      }
    });

    console.log('Created subscription:', subscription.id);

    // Update loan with subscription details
    loan.razorpaySubscriptionId = subscription.id;
    loan.autopayStatus = 'pending';
    await loan.save();

    res.json({
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url,
      status: subscription.status,
      customerId: customerId,
      planId: plan.id,
      totalCount: billingCycles,
      note: 'Charges every 7 days (7 EMIs per charge)'
    });
  } catch (error) {
    console.error('Setup autopay error:', error);
    res.status(500).json({ message: error.error?.description || 'Error setting up autopay' });
  }
});

// @route   POST /api/payment/verify-autopay
// @desc    Verify autopay subscription authentication
// @access  Private
router.post('/verify-autopay', protect, async (req, res) => {
  try {
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature, loanId } = req.body;

    console.log('=== Verify Autopay Request ===');
    console.log('Subscription ID:', razorpay_subscription_id);
    console.log('Payment ID:', razorpay_payment_id);
    console.log('Loan ID:', loanId);

    if (!razorpay_subscription_id || !razorpay_payment_id || !razorpay_signature || !loanId) {
      return res.status(400).json({ message: 'Missing autopay details' });
    }

    // Verify signature
    const body = razorpay_payment_id + '|' + razorpay_subscription_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    const isAuthentic = expectedSignature === razorpay_signature;

    if (!isAuthentic) {
      console.log('Autopay signature verification failed');
      return res.status(400).json({ message: 'Autopay verification failed' });
    }

    // Update loan
    const loan = await Loan.findById(loanId);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    loan.autopayEnabled = true;
    loan.autopayStatus = 'active';
    await loan.save();

    // Mark first 7 EMIs as paid (subscription charges 7 days at a time)
    const firstBatch = await EMI.find({
      loanId: loan._id,
      status: { $ne: 'paid' }
    }).sort({ dayNumber: 1 }).limit(7);

    for (const emi of firstBatch) {
      emi.status = 'paid';
      emi.razorpayPaymentId = razorpay_payment_id;
      emi.paidAt = new Date();
      await emi.save();
      loan.totalPaid += emi.totalAmount;
      loan.remainingBalance -= (emi.principalAmount + emi.interestAmount);
    }
    await loan.save();

    const notif = await Notification.create({
      type: 'emi_paid',
      forAdmin: true,
      userId: loan.userId,
      loanId: loan._id,
      title: 'Autopay Activated',
      body: `Autopay set up and ₹${(firstBatch.reduce((sum, e) => sum + e.totalAmount, 0)).toLocaleString('en-IN')} collected from ${loan.applicantName}`,
    });

    const { emitNotification } = require('../socket');
    await emitNotification(notif);

    console.log('Autopay activated for loan:', loanId);

    res.json({
      message: 'Autopay activated successfully',
      autopayStatus: 'active',
      loanId: loan._id
    });
  } catch (error) {
    console.error('Verify autopay error:', error);
    res.status(500).json({ message: 'Error verifying autopay' });
  }
});

// @route   POST /api/payment/cancel-autopay
// @desc    Cancel autopay subscription
// @access  Private
router.post('/cancel-autopay', protect, async (req, res) => {
  try {
    const { loanId } = req.body;

    console.log('=== Cancel Autopay Request ===');
    console.log('Loan ID:', loanId);

    if (!loanId) {
      return res.status(400).json({ message: 'Loan ID is required' });
    }

    const loan = await Loan.findById(loanId);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Check ownership
    if (loan.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!loan.razorpaySubscriptionId) {
      return res.status(400).json({ message: 'No autopay subscription found' });
    }

    // Cancel subscription in Razorpay
    if (razorpay) {
      await razorpay.subscriptions.cancel(loan.razorpaySubscriptionId);
      console.log('Cancelled subscription:', loan.razorpaySubscriptionId);
    }

    // Update loan
    loan.autopayEnabled = false;
    loan.autopayStatus = 'cancelled';
    await loan.save();

    res.json({
      message: 'Autopay cancelled successfully',
      loanId: loan._id
    });
  } catch (error) {
    console.error('Cancel autopay error:', error);
    res.status(500).json({ message: 'Error cancelling autopay' });
  }
});

// @route   GET /api/payment/autopay-status/:loanId
// @desc    Get autopay status for a loan
// @access  Private
router.get('/autopay-status/:loanId', protect, async (req, res) => {
  try {
    const { loanId } = req.params;

    const loan = await Loan.findById(loanId);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Check ownership
    if (loan.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let subscriptionDetails = null;

    if (loan.razorpaySubscriptionId && razorpay) {
      try {
        subscriptionDetails = await razorpay.subscriptions.fetch(loan.razorpaySubscriptionId);
      } catch (e) {
        console.log('Could not fetch subscription:', e.message);
      }
    }

    res.json({
      autopayEnabled: loan.autopayEnabled,
      autopayStatus: loan.autopayStatus,
      subscriptionId: loan.razorpaySubscriptionId,
      subscriptionDetails
    });
  } catch (error) {
    console.error('Get autopay status error:', error);
    res.status(500).json({ message: 'Error fetching autopay status' });
  }
});

module.exports = router;
