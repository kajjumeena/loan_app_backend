const express = require('express');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin
      ? { forAdmin: true, read: { $ne: true } }
      : { userId: req.user._id, forAdmin: false, read: { $ne: true } };
    const count = await Notification.countDocuments(query);
    res.json({ count });
  } catch (e) {
    res.status(500).json({ message: 'Error' });
  }
});

// GET /api/notifications - user notifications (forAdmin: false, userId = current user)
router.get('/', async (req, res) => {
  try {
    const { filter } = req.query; // 'paid' | 'pending' | null for all
    let query = { userId: req.user._id, forAdmin: false };
    if (filter === 'paid') query.type = 'emi_paid';
    if (filter === 'pending') query.$or = [{ type: 'emi_pending_today' }, { type: 'emi_overdue' }];
    const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(50).lean();
    res.json(notifications);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching notifications' });
  }
});

// GET /api/notifications/admin - admin notifications
router.get('/admin', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { filter } = req.query;
    let query = { forAdmin: true };
    if (filter === 'paid') query.type = 'emi_paid';
    if (filter === 'pending') query.$or = [{ type: 'loan_request' }, { type: 'emi_pending_today' }, { type: 'emi_overdue' }];
    const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(50)
      .populate('userId', 'name email mobile')
      .populate('loanId', 'amount applicantName')
      .lean();
    res.json(notifications);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching notifications' });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  try {
    const n = await Notification.findByIdAndUpdate(
      req.params.id,
      { read: true },
      { new: true }
    );
    if (!n) return res.status(404).json({ message: 'Not found' });
    res.json(n);
  } catch (e) {
    res.status(500).json({ message: 'Error' });
  }
});

module.exports = router;
