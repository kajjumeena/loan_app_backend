require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const connectDB = require('./config/db');
const { processOverdueEMIs } = require('./services/emiCalculator');
const { initSocket } = require('./socket');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const loanRoutes = require('./routes/loan');
const emiRoutes = require('./routes/emi');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payment');
const notificationRoutes = require('./routes/notification');
const webhookRoutes = require('./routes/webhook');
const settingsRoutes = require('./routes/settings');

const app = express();

// Connect to MongoDB
connectDB();

// CORS - must be first. Allow all origins for Railway + web/mobile clients
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false,
  optionsSuccessStatus: 200,
}));

// Webhook must use raw body for signature verification
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), webhookRoutes);

// Increased limit for profile updates with base64 images
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/loan', loanRoutes);
app.use('/api/emi', emiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);

// Root - simple 200 for proxies
app.get('/', (req, res) => {
  res.status(200).json({ status: 'OK', api: 'Loan App' });
});

// Health check - Railway uses this to verify deployment
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Loan App API is running' });
});

// Config (for frontend - loan duration)
app.get('/api/config', (req, res) => {
  res.json({ totalDays: 100 });
});

// Schedule cron job to process overdue EMIs every day at 12:10 AM IST (18:40 UTC)
cron.schedule('40 18 * * *', async () => {
  console.log('Running daily overdue EMI processing...');
  try {
    await processOverdueEMIs();
  } catch (error) {
    console.error('Error processing overdue EMIs:', error);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initSocket(server);

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  // Process overdue EMIs on server startup (Render free tier may miss cron while sleeping)
  try {
    const count = await processOverdueEMIs();
    console.log(`Startup: processed ${count} overdue EMI(s)`);
  } catch (e) {
    console.error('Startup overdue processing error:', e);
  }
});

// Graceful shutdown - Railway sends SIGTERM when stopping the container
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => {
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
