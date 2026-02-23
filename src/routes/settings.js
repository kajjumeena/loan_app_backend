const express = require('express');
const AppSettings = require('../models/AppSettings');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/auth');

const router = express.Router();

const DEFAULTS = AppSettings.DEFAULTS || {
  upiId: '9530305519-9@axl',
  upiNumber: '9530305519',
  supportNumber: '9672030409',
  helpText: '',
};

// @route   GET /api/settings
// @desc    Get app settings (QR, UPI, support, help) - for user help page
// @access  Private (any logged-in user)
router.get('/', protect, async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) {
      settings = {
        qrImageBase64: '',
        upiId: DEFAULTS.upiId,
        upiNumber: DEFAULTS.upiNumber,
        supportNumber: DEFAULTS.supportNumber,
        helpText: DEFAULTS.helpText,
      };
    } else {
      settings = settings.toObject();
    }
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ message: 'Failed to load settings' });
  }
});

// @route   GET /api/admin/settings (or PUT /api/settings with admin)
// @desc    Admin: get/update app settings
// Using /api/settings with admin check for PUT
module.exports = router;
module.exports.DEFAULTS = DEFAULTS;
