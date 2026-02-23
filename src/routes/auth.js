const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const User = require('../models/User');

const router = express.Router();

// Brevo API Configuration
const BREVO_API_KEY = process.env.BREVO_API_KEY || process.env.SMTP_PASS;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

// Generate random 4-digit OTP
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Send OTP via Brevo HTTP API (More reliable on cloud platforms like Render)
const sendOTPViaEmail = async (email, otp) => {
  if (!BREVO_API_KEY) {
    console.log('Brevo API Key not configured - Printing OTP:', otp);
    return;
  }

  try {
    const response = await axios.post(BREVO_API_URL, {
      sender: {
        name: "LoanSnap",
        email: process.env.SMTP_FROM_EMAIL || "sachinswaminbt@gmail.com"
      },
      to: [{ email: email }],
      subject: 'Your LoanSnap OTP',
      htmlContent: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px; margin: auto;">
          <h2 style="color: #6B46C1; text-align: center;">LoanSnap Login</h2>
          <p style="font-size: 16px; color: #333;">Your One-Time Password (OTP) for logging into your account is:</p>
          <div style="background: #f4f4f4; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #6B46C1;">${otp}</span>
          </div>
          <p style="font-size: 14px; color: #666; text-align: center;">This OTP is valid for 5 minutes. Do not share it with anyone.</p>
        </div>`
    }, {
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    console.log('Email sent via Brevo API:', response.data.messageId);
  } catch (error) {
    console.error('Error sending email via Brevo API:', error.response?.data || error.message);
    throw new Error('Failed to send OTP email');
  }
};

// @route   POST /api/auth/send-otp
// @desc    Send OTP to email
// @access  Public
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !String(email).trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const emailStr = String(email).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailStr)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    let user = await User.findOne({ email: emailStr });

    if (!user) {
      user = new User({ email: emailStr });
    }

    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send OTP via Brevo HTTP API
    if (BREVO_API_KEY) {
      await sendOTPViaEmail(emailStr, otp);
      res.json({ message: 'OTP sent to your email' });
    } else {
      console.log(`OTP for ${emailStr}: ${otp}`);
      res.json({ message: 'OTP sent (testing)', otp });
    }
  } catch (error) {
    console.error('Send OTP error:', error.message, error);
    res.status(500).json({ message: error.message || 'Error sending OTP' });
  }
});

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and login
// @access  Public
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    if (new Date() > user.otpExpiry) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    const token = generateToken(user._id);
    const needsMobile = !user.mobile || !String(user.mobile).trim();

    res.json({
      message: 'Login successful',
      token,
      needsMobile,
      user: {
        id: user._id,
        email: user.email,
        mobile: user.mobile || '',
        name: user.name,
        role: user.role,
        address: user.address,
        addresses: user.addresses || [],
        aadhaarNumber: user.aadhaarNumber,
        panNumber: user.panNumber,
        aadhaarImage: user.aadhaarImage,
        panImage: user.panImage
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ message: 'Error verifying OTP' });
  }
});

// @route   POST /api/auth/find-email
// @desc    Find email by mobile number
// @access  Public
router.post('/find-email', async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({ message: 'Mobile number is required' });
    }

    const user = await User.findOne({ mobile: String(mobile).trim() });

    if (!user) {
      return res.status(404).json({ message: 'This mobile number is not registered' });
    }

    res.json({ email: user.email });
  } catch (error) {
    console.error('Find email error:', error);
    res.status(500).json({ message: 'Error finding email' });
  }
});

module.exports = router;
