const express = require('express');
const crypto = require('crypto');
const EMI = require('../models/EMI');
const Loan = require('../models/Loan');

const router = express.Router();

// Webhook uses raw body - must be mounted with express.raw() in index.js

// @route   POST /api/webhooks/razorpay
// @desc    Handle Razorpay webhook events (subscription.charged, etc.)
// @access  Public (verified by signature)
router.post('/', (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not configured');
      return res.status(500).send('Webhook secret not configured');
    }

    // req.body is raw Buffer when using express.raw()
    const rawBody = req.body.toString('utf8');
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
      console.error('Webhook: Missing signature');
      return res.status(400).send('Missing signature');
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error('Webhook: Invalid signature');
      return res.status(400).send('Invalid signature');
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event;

    console.log('=== Razorpay Webhook ===');
    console.log('Event:', event);

    // Respond 200 immediately - process async
    res.status(200).send('OK');

    // Process event asynchronously
    handleWebhookEvent(event, payload).catch(err => {
      console.error('Webhook processing error:', err);
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

async function handleWebhookEvent(event, payload) {
  if (event === 'subscription.charged') {
    await handleSubscriptionCharged(payload);
  } else if (event === 'subscription.cancelled') {
    await handleSubscriptionCancelled(payload);
  } else if (event === 'payment.captured') {
    // Optional: handle one-time payment capture
    console.log('Payment captured:', payload.payload?.payment?.entity?.id);
  } else {
    console.log('Unhandled webhook event:', event);
  }
}

async function handleSubscriptionCharged(payload) {
  try {
    const subscriptionEntity = payload.payload?.subscription?.entity;
    const paymentEntity = payload.payload?.payment?.entity;

    if (!subscriptionEntity || !paymentEntity) {
      console.error('Webhook: Invalid subscription.charged payload');
      return;
    }

    const loanId = subscriptionEntity.notes?.loanId;
    const paymentId = paymentEntity.id;
    const amount = paymentEntity.amount / 100; // paise to rupees

    console.log('Subscription charged - LoanId:', loanId, 'PaymentId:', paymentId, 'Amount:', amount);

    if (!loanId) {
      console.error('Webhook: No loanId in subscription notes');
      return;
    }

    // Find up to 7 pending EMIs (each subscription charge = 7 days of EMI)
    const pendingEmis = await EMI.find({
      loanId,
      status: { $ne: 'paid' }
    }).sort({ dayNumber: 1 }).limit(7);

    if (pendingEmis.length === 0) {
      console.log('Webhook: No pending EMI found for loan', loanId);
      return;
    }

    const loan = await Loan.findById(loanId);
    if (!loan) return;

    // Mark all EMIs in this batch as paid
    for (const emi of pendingEmis) {
      emi.status = 'paid';
      emi.razorpayPaymentId = paymentId;
      emi.paidAt = new Date();
      await emi.save();

      loan.totalPaid += emi.totalAmount;
      loan.remainingBalance -= (emi.principalAmount + emi.interestAmount);
    }

    // Check if loan is completed
    const remainingPending = await EMI.countDocuments({
      loanId,
      status: { $ne: 'paid' }
    });

    if (remainingPending === 0) {
      loan.status = 'completed';
    }

    await loan.save();

    console.log('Webhook: EMIs marked as paid -', pendingEmis.length, 'EMIs, Loan:', loanId);

    // Alert Admin
    try {
      const Notification = require('../models/Notification');
      const { emitNotification } = require('../socket');

      const notif = await Notification.create({
        type: 'emi_paid',
        forAdmin: true,
        userId: loan.userId,
        loanId: loan._id,
        title: 'EMI Paid (Autopay)',
        body: `₹${amount.toLocaleString('en-IN')} collected via Autopay for ${loan.applicantName}`,
      });
      await emitNotification(notif);
    } catch (notifErr) {
      console.error('Webhook notification error:', notifErr);
    }
  } catch (error) {
    console.error('handleSubscriptionCharged error:', error);
    throw error;
  }
}

async function handleSubscriptionCancelled(payload) {
  try {
    const subscriptionEntity = payload.payload?.subscription?.entity;
    const loanId = subscriptionEntity?.notes?.loanId;

    if (loanId) {
      await Loan.findByIdAndUpdate(loanId, {
        autopayEnabled: false,
        autopayStatus: 'cancelled'
      });
      console.log('Webhook: Autopay cancelled for loan', loanId);
    }
  } catch (error) {
    console.error('handleSubscriptionCancelled error:', error);
  }
}

module.exports = router;
