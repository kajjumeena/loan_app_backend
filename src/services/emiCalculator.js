const EMI = require('../models/EMI');
const Loan = require('../models/Loan');

/**
 * Generate EMI schedule for an approved loan
 * @param {Object} loan - The approved loan document
 * @returns {Array} Array of EMI documents
 */
const generateEMISchedule = async (loan) => {
  const emis = [];
  // Start from next day (not same day)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);
  startDate.setHours(0, 0, 0, 0);

  const totalInterest = loan.amount * 0.20; // 20% of total amount
  const dailyPrincipal = Math.ceil(loan.amount / loan.totalDays);
  const dailyInterest = Math.ceil(totalInterest / loan.totalDays);

  for (let day = 1; day <= loan.totalDays; day++) {
    const dueDate = new Date(startDate);
    dueDate.setDate(startDate.getDate() + day - 1);

    const emi = new EMI({
      loanId: loan._id,
      userId: loan.userId,
      dayNumber: day,
      principalAmount: dailyPrincipal,
      interestAmount: dailyInterest,
      penaltyAmount: 0,
      totalAmount: dailyPrincipal + dailyInterest,
      dueDate: dueDate,
      status: 'pending'
    });

    emis.push(emi);
  }

  // Bulk insert EMIs
  await EMI.insertMany(emis);

  // Update loan start and end dates
  loan.startDate = startDate;
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + loan.totalDays - 1);
  loan.endDate = endDate;
  loan.approvedAt = new Date();
  await loan.save();

  return emis;
};

/**
 * Mark overdue EMIs and apply penalties.
 * 
 * Rules:
 * - An EMI becomes overdue only AFTER its due date (if due 16th, overdue starts 17th)
 * - Penalty per day = 50% of principalAmount
 * - Penalty accumulates: daysOverdue * (principalAmount / 2)
 *   Example: principal 50, due 13th Feb, today 16th Feb → 3 days → penalty = 25 * 3 = 75
 * 
 * Run daily via cron; admin can also trigger via "Process Overdues" button.
 */
const processOverdueEMIs = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // $lt: today means only EMIs whose due date is BEFORE today (not including today).
  // So an EMI due on 16th Feb won't be overdue on 16th Feb; it becomes overdue on 17th.
  const lateEMIs = await EMI.find({
    status: { $in: ['pending', 'overdue'] },
    dueDate: { $lt: today }
  });

  let processedCount = 0;

  for (const emi of lateEMIs) {
    const dueDate = new Date(emi.dueDate);
    dueDate.setHours(0, 0, 0, 0);

    // Days overdue = number of full days between due date and today
    // Due 13th, today 16th → (16-13) = 3 days overdue
    const diffMs = today.getTime() - dueDate.getTime();
    const daysOverdue = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    if (daysOverdue <= 0) continue;

    emi.status = 'overdue';

    // Penalty per day = 50% of principalAmount (e.g. principal 50 -> penalty 25 per day)
    const penaltyPerDay = Math.ceil(emi.principalAmount / 2);
    const newPenalty = penaltyPerDay * daysOverdue;
    const oldPenalty = emi.penaltyAmount || 0;

    if (newPenalty !== oldPenalty) {
      const delta = newPenalty - oldPenalty;
      emi.penaltyAmount = newPenalty;
      emi.totalAmount = emi.principalAmount + emi.interestAmount + newPenalty;
      await emi.save();

      // Update loan-level penalty total
      await Loan.findByIdAndUpdate(emi.loanId, {
        $inc: { penaltyAmount: delta }
      });
      processedCount++;
    } else if (emi.isModified('status')) {
      await emi.save();
      processedCount++;
    }
  }

  console.log(`Processed ${processedCount} late EMIs. Checked ${lateEMIs.length} total.`);
  return processedCount;
};

/**
 * Calculate loan statistics
 * @param {String} loanId - Loan ID
 * @returns {Object} Loan statistics
 */
const getLoanStats = async (loanId) => {
  const emis = await EMI.find({ loanId });

  const stats = {
    totalEMIs: emis.length,
    paidEMIs: 0,
    pendingEMIs: 0,
    overdueEMIs: 0,
    totalPaid: 0,
    totalPending: 0,
    totalPenalty: 0
  };

  emis.forEach(emi => {
    if (emi.status === 'paid') {
      stats.paidEMIs++;
      stats.totalPaid += emi.totalAmount;
    } else if (emi.status === 'pending') {
      stats.pendingEMIs++;
      stats.totalPending += emi.totalAmount;
    } else if (emi.status === 'overdue') {
      stats.overdueEMIs++;
      stats.totalPending += emi.totalAmount;
      stats.totalPenalty += emi.penaltyAmount;
    }
  });

  return stats;
};

module.exports = {
  generateEMISchedule,
  processOverdueEMIs,
  getLoanStats
};
