const express = require('express');
const cloudinary = require('cloudinary').v2;
const User = require('../models/User');
const Loan = require('../models/Loan');
const EMI = require('../models/EMI');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Configure Cloudinary
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// @route   GET /api/user/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-otp -otpExpiry');
    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Error fetching profile' });
  }
});

// @route   POST /api/user/upload-image
// @desc    Upload image to Cloudinary, returns URL
// @access  Private
router.post('/upload-image', protect, async (req, res) => {
  try {
    const { image, folder } = req.body; // image = base64 data URI
    if (!image) return res.status(400).json({ message: 'Image is required' });
    if (!cloudinary.config().cloud_name) return res.status(500).json({ message: 'Cloudinary not configured' });

    const result = await cloudinary.uploader.upload(image, {
      folder: folder || 'loan_app',
      resource_type: 'image'
    });
    res.json({ url: result.secure_url });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: error.message || 'Image upload failed' });
  }
});

// Upload base64 to Cloudinary, return URL. If already URL, return as-is.
const uploadIfBase64 = async (value, folder = 'loan_app/documents') => {
  if (!value || typeof value !== 'string') return '';
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (!value.startsWith('data:')) return '';
  if (!cloudinary.config().cloud_name) throw new Error('Cloudinary not configured');
  const result = await cloudinary.uploader.upload(value, { folder, resource_type: 'image' });
  return result.secure_url;
};

// @route   PUT /api/user/profile
// @desc    Update user profile (accepts all fields including base64 images - uploads to Cloudinary)
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, mobile, address, addresses, aadhaarNumber, panNumber, aadhaarImage, panImage } = req.body;

    const user = await User.findById(req.user._id);

    if (name !== undefined) user.name = name;
    if (mobile !== undefined) user.mobile = String(mobile || '').trim();
    if (address !== undefined) user.address = address;
    if (Array.isArray(addresses)) user.addresses = addresses.filter(a => a && String(a).trim());
    if (aadhaarNumber !== undefined) user.aadhaarNumber = String(aadhaarNumber || '').trim();
    if (panNumber !== undefined) user.panNumber = String(panNumber || '').trim().toUpperCase();

    // Upload base64 images to Cloudinary (folder: loan_app/documents)
    if (aadhaarImage !== undefined) {
      user.aadhaarImage = (await uploadIfBase64(aadhaarImage)) || '';
    }
    if (panImage !== undefined) {
      user.panImage = (await uploadIfBase64(panImage)) || '';
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.otp;
    delete userObj.otpExpiry;
    res.json({
      message: 'Profile updated successfully',
      user: userObj
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: error.message || 'Error updating profile' });
  }
});

// @route   GET /api/user/dashboard
// @desc    Get user dashboard with loan and EMI stats
// @access  Private
router.get('/dashboard', protect, async (req, res) => {
  try {
    // Get all loans for user
    const loans = await Loan.find({ userId: req.user._id });

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get pending EMIs for today
    const todayEMIs = await EMI.find({
      userId: req.user._id,
      dueDate: { $gte: today, $lt: tomorrow },
      status: { $in: ['pending', 'overdue'] }
    }).populate('loanId', 'amount');

    // Get all pending/overdue EMIs
    const pendingEMIs = await EMI.find({
      userId: req.user._id,
      status: { $in: ['pending', 'overdue'] }
    }).sort({ dueDate: 1 });

    // Calculate totals
    let totalLoanAmount = 0;
    let totalPaid = 0;
    let remainingBalance = 0;
    let totalPenalty = 0;

    loans.forEach(loan => {
      if (loan.status === 'approved' || loan.status === 'completed') {
        totalLoanAmount += loan.amount;
        totalPaid += loan.totalPaid;
        remainingBalance += loan.remainingBalance;
        totalPenalty += loan.penaltyAmount;
      }
    });

    res.json({
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        mobile: req.user.mobile,
        address: req.user.address,
        addresses: req.user.addresses || [],
        aadhaarNumber: req.user.aadhaarNumber,
        panNumber: req.user.panNumber,
        aadhaarImage: req.user.aadhaarImage,
        panImage: req.user.panImage
      },
      stats: {
        totalLoans: loans.length,
        activeLoans: loans.filter(l => l.status === 'approved').length,
        pendingApplications: loans.filter(l => l.status === 'pending').length,
        totalLoanAmount,
        totalPaid,
        remainingBalance,
        totalPenalty
      },
      todayEMIs,
      upcomingEMIs: pendingEMIs.slice(0, 5)
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Error fetching dashboard' });
  }
});

// @route   POST /api/user/push-token
// @desc    Update push token
// @access  Private
router.post('/push-token', protect, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token required' });

    await User.findByIdAndUpdate(req.user._id, { pushToken: token });
    res.json({ message: 'Push token updated' });
  } catch (error) {
    console.error('Update push token error:', error);
    res.status(500).json({ message: 'Error updating push token' });
  }
});

module.exports = router;
