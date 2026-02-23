require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const ADMIN_EMAIL = 'sachin.dev@thesukrut.com';
const ADMIN_MOBILE = '7877722306';
const ADMIN_NAME = 'Sachin Admin';

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');

    const user = await User.findOneAndUpdate(
      { email: ADMIN_EMAIL.toLowerCase() },
      {
        email: ADMIN_EMAIL.toLowerCase(),
        mobile: ADMIN_MOBILE,
        name: ADMIN_NAME,
        role: 'admin',
      },
      { upsert: true, new: true }
    );

    console.log('Admin user created/updated:', {
      email: user.email,
      mobile: user.mobile,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seedAdmin();
