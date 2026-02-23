require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Loan = require('../src/models/Loan');
const EMI = require('../src/models/EMI');
const Notification = require('../src/models/Notification');

async function clearAll() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');

    const emiResult = await EMI.deleteMany({});
    const loanResult = await Loan.deleteMany({});
    const notifResult = await Notification.deleteMany({});
    const userResult = await User.deleteMany({});

    console.log(`Deleted ${emiResult.deletedCount} EMIs`);
    console.log(`Deleted ${loanResult.deletedCount} loans`);
    console.log(`Deleted ${notifResult.deletedCount} notifications`);
    console.log(`Deleted ${userResult.deletedCount} users`);
    console.log('Done. Database cleared.');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

clearAll();
