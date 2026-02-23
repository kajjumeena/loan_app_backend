const mongoose = require('mongoose');
const User = require('../models/User');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Drop old mobile unique index (migration: mobile is now optional, not unique)
    try {
      await User.collection.dropIndex('mobile_1');
      console.log('Dropped old mobile_1 unique index');
    } catch (e) {
      if (e.code !== 27 && !e.message?.includes('index not found')) console.log('Index mobile_1 already removed or not found');
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
