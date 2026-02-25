require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const ADMIN_EMAIL = 'kajjukhoda@gmail.com';
const ADMIN_MOBILE = '9530305519';
const ADMIN_NAME = 'Kajju Khoda';

async function addAdmin() {
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
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

addAdmin();
