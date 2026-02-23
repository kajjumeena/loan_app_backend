require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Loan = require('../src/models/Loan');
const EMI = require('../src/models/EMI');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('Connection error:', error);
    process.exit(1);
  }
};

const checkOverdues = async () => {
  await connectDB();

  const name = 'Narendra';
  const mobile = '8829995814';

  console.log(`\n=== Searching for user: ${name}, Mobile: ${mobile} ===\n`);

  // Find user by name or mobile
  const user = await User.findOne({
    $or: [
      { name: { $regex: name, $options: 'i' } },
      { mobile: mobile }
    ]
  });

  if (!user) {
    console.log('User not found!');
    await mongoose.connection.close();
    return;
  }

  console.log('User found:');
  console.log(`  ID: ${user._id}`);
  console.log(`  Name: ${user.name || 'N/A'}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Mobile: ${user.mobile || 'N/A'}`);
  console.log('');

  // Find all loans for this user
  const loans = await Loan.find({ userId: user._id }).sort({ createdAt: -1 });
  console.log(`Total Loans: ${loans.length}\n`);

  if (loans.length === 0) {
    console.log('No loans found for this user.');
    await mongoose.connection.close();
    return;
  }

  // Find all overdue EMIs
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdueEMIs = await EMI.find({
    userId: user._id,
    status: 'overdue'
  }).populate('loanId', 'amount applicantName status').sort({ dueDate: 1 });

  console.log(`=== OVERDUE EMIs: ${overdueEMIs.length} ===\n`);

  if (overdueEMIs.length === 0) {
    console.log('No overdue EMIs found.');
  } else {
    overdueEMIs.forEach((emi, index) => {
      const dueDate = new Date(emi.dueDate);
      const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
      
      console.log(`${index + 1}. EMI Details:`);
      console.log(`   Loan ID: ${emi.loanId._id}`);
      console.log(`   Loan Amount: ₹${emi.loanId.amount?.toLocaleString('en-IN') || 'N/A'}`);
      console.log(`   Loan Status: ${emi.loanId.status}`);
      console.log(`   Day Number: ${emi.dayNumber}`);
      console.log(`   Due Date: ${dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);
      console.log(`   Days Overdue: ${daysOverdue} days`);
      console.log(`   Principal: ₹${emi.principalAmount?.toLocaleString('en-IN') || 0}`);
      console.log(`   Interest: ₹${emi.interestAmount?.toLocaleString('en-IN') || 0}`);
      console.log(`   Penalty: ₹${emi.penaltyAmount?.toLocaleString('en-IN') || 0}`);
      console.log(`   Total Amount: ₹${emi.totalAmount?.toLocaleString('en-IN') || 0}`);
      console.log(`   Status: ${emi.status}`);
      console.log('');
    });

    // Summary
    const totalOverdue = overdueEMIs.reduce((sum, emi) => sum + (emi.totalAmount || 0), 0);
    const totalPenalty = overdueEMIs.reduce((sum, emi) => sum + (emi.penaltyAmount || 0), 0);
    
    console.log('=== SUMMARY ===');
    console.log(`Total Overdue EMIs: ${overdueEMIs.length}`);
    console.log(`Total Overdue Amount: ₹${totalOverdue.toLocaleString('en-IN')}`);
    console.log(`Total Penalty: ₹${totalPenalty.toLocaleString('en-IN')}`);
    console.log(`Total Payable: ₹${(totalOverdue + totalPenalty).toLocaleString('en-IN')}`);
  }

  // Also check pending EMIs that might be overdue but not marked as overdue
  const pendingEMIs = await EMI.find({
    userId: user._id,
    status: 'pending',
    dueDate: { $lt: today }
  }).populate('loanId', 'amount applicantName status').sort({ dueDate: 1 });

  if (pendingEMIs.length > 0) {
    console.log(`\n=== PENDING EMIs Past Due Date: ${pendingEMIs.length} ===\n`);
    pendingEMIs.forEach((emi, index) => {
      const dueDate = new Date(emi.dueDate);
      const daysPastDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
      
      console.log(`${index + 1}. EMI Details:`);
      console.log(`   Loan ID: ${emi.loanId._id}`);
      console.log(`   Day Number: ${emi.dayNumber}`);
      console.log(`   Due Date: ${dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);
      console.log(`   Days Past Due: ${daysPastDue} days`);
      console.log(`   Total Amount: ₹${emi.totalAmount?.toLocaleString('en-IN') || 0}`);
      console.log(`   Status: ${emi.status} (should be marked as overdue)`);
      console.log('');
    });
  }

  await mongoose.connection.close();
  console.log('\nDatabase connection closed.');
};

checkOverdues().catch(console.error);
