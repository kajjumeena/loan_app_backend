/**
 * Fix overdue EMI data in the database.
 * 
 * This script:
 * 1. Finds ALL overdue EMIs
 * 2. Recalculates penalty correctly: Math.ceil(principalAmount/2) * daysOverdue (50% of principal per day)
 * 3. Resets EMIs that are NOT actually overdue (due date >= today) back to 'pending'
 * 4. Recalculates loan-level penaltyAmount totals
 */
require('dotenv').config();
const mongoose = require('mongoose');
const EMI = require('../src/models/EMI');
const Loan = require('../src/models/Loan');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB Connected\n');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  console.log(`Today (midnight): ${today.toISOString()}\n`);

  // Find all non-paid EMIs (both overdue and pending)
  const allUnpaidEMIs = await EMI.find({
    status: { $in: ['pending', 'overdue'] }
  }).populate('loanId', 'amount dailyInterest');

  // Track loan penalty changes so we can recalculate loan-level totals
  const loanPenaltyMap = {};

  let fixedCount = 0;
  let resetToPending = 0;
  let recalculated = 0;

  for (const emi of allUnpaidEMIs) {
    const dueDate = new Date(emi.dueDate);
    dueDate.setHours(0, 0, 0, 0);

    const diffMs = today.getTime() - dueDate.getTime();
    const daysOverdue = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    const loanId = emi.loanId._id.toString();
    if (!loanPenaltyMap[loanId]) loanPenaltyMap[loanId] = 0;

    if (daysOverdue <= 0) {
      // This EMI is NOT overdue (due today or in the future)
      if (emi.status === 'overdue' || emi.penaltyAmount > 0) {
        const oldStatus = emi.status;
        const oldPenalty = emi.penaltyAmount;

        emi.status = 'pending';
        emi.penaltyAmount = 0;
        emi.totalAmount = emi.principalAmount + emi.interestAmount;
        await emi.save();

        console.log(`RESET Day ${emi.dayNumber} (due ${dueDate.toLocaleDateString('en-IN')}): ${oldStatus} → pending, penalty ₹${oldPenalty} → ₹0`);
        resetToPending++;
        fixedCount++;
      }
    } else {
      // This EMI IS overdue - 50% of principal per day
      const penaltyPerDay = Math.ceil((emi.principalAmount || 0) / 2);
      const correctPenalty = penaltyPerDay * daysOverdue;
      const correctTotal = emi.principalAmount + emi.interestAmount + correctPenalty;
      const oldPenalty = emi.penaltyAmount;

      loanPenaltyMap[loanId] += correctPenalty;

      if (emi.status !== 'overdue' || emi.penaltyAmount !== correctPenalty || emi.totalAmount !== correctTotal) {
        emi.status = 'overdue';
        emi.penaltyAmount = correctPenalty;
        emi.totalAmount = correctTotal;
        await emi.save();

        console.log(`FIX Day ${emi.dayNumber} (due ${dueDate.toLocaleDateString('en-IN')}): ${daysOverdue} days overdue, penalty ₹${oldPenalty} → ₹${correctPenalty}, total ₹${correctTotal}`);
        recalculated++;
        fixedCount++;
      } else {
        console.log(`OK  Day ${emi.dayNumber} (due ${dueDate.toLocaleDateString('en-IN')}): ${daysOverdue} days overdue, penalty ₹${correctPenalty} ✓`);
      }
    }
  }

  // Now fix loan-level penalty totals
  console.log('\n=== Fixing Loan Penalty Totals ===\n');
  for (const [loanId, correctPenalty] of Object.entries(loanPenaltyMap)) {
    const loan = await Loan.findById(loanId);
    if (!loan) continue;

    const oldPenalty = loan.penaltyAmount || 0;
    if (oldPenalty !== correctPenalty) {
      loan.penaltyAmount = correctPenalty;
      await loan.save();
      console.log(`Loan ${loanId}: penalty ₹${oldPenalty} → ₹${correctPenalty}`);
    } else {
      console.log(`Loan ${loanId}: penalty ₹${correctPenalty} ✓`);
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total unpaid EMIs checked: ${allUnpaidEMIs.length}`);
  console.log(`Reset to pending (were wrongly overdue): ${resetToPending}`);
  console.log(`Penalty recalculated: ${recalculated}`);
  console.log(`Total fixed: ${fixedCount}`);

  await mongoose.connection.close();
  console.log('\nDone.');
};

run().catch(console.error);
