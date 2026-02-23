const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

let io = null;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: '*' },
    pingTimeout: 60000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('role');
      if (!user) return next(new Error('User not found'));
      socket.userId = decoded.id;
      socket.isAdmin = user.role === 'admin';
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);
    if (socket.isAdmin) socket.join('admin');
    socket.emit('connected', { userId });
  });

  return io;
};

const { Expo } = require('expo-server-sdk');
let expo = new Expo();

const getIO = () => io;

const sendPushNotifications = async (tokens, title, body, data = {}) => {
  if (!tokens || tokens.length === 0) return;

  let messages = [];
  for (let pushToken of tokens) {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      continue;
    }
    messages.push({
      to: pushToken,
      sound: 'default',
      title: title,
      body: body,
      data: data,
    });
  }

  let chunks = expo.chunkPushNotifications(messages);

  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      // console.log(ticketChunk);
    } catch (error) {
      console.error(error);
    }
  }
};

const emitNotification = async (notification) => {
  if (!io) {
    console.log('Socket.io not initialized, cannot emit notification');
    return;
  }
  const n = notification.toObject ? notification.toObject() : notification;

  if (n.forAdmin) {
    console.log(`Emitting admin notification: ${n.title}`);
    io.to('admin').emit('notification', n);

    // Send push to admins
    try {
      const admins = await User.find({ role: 'admin', pushToken: { $exists: true, $ne: '' } });
      console.log(`Found ${admins.length} admins to notify via push`);
      const tokens = admins.map(u => u.pushToken).filter(t => t && t.startsWith('ExponentPushToken'));
      console.log(`Valid admin push tokens: ${tokens.length}`);

      if (tokens.length > 0) {
        await sendPushNotifications(tokens, n.title || 'Admin Alert', n.body, { loanId: n.loanId, type: n.type });
      }
    } catch (e) {
      console.error('Admin Push Error:', e);
    }

  } else if (n.userId) {
    const uid = n.userId._id || n.userId;
    console.log(`Emitting user notification to user:${uid}: ${n.title}`);
    io.to(`user:${uid}`).emit('notification', n);

    // Send push to user
    try {
      const user = await User.findById(uid);
      if (user && user.pushToken && user.pushToken.startsWith('ExponentPushToken')) {
        console.log(`Sending push notification to user ${uid}`);
        await sendPushNotifications([user.pushToken], n.title || 'LoanSnap', n.body, { loanId: n.loanId, type: n.type });
      } else {
        console.log(`User ${uid} has no valid push token`);
      }
    } catch (e) {
      console.error('User Push Error:', e);
    }
  }
};

module.exports = { initSocket, getIO, emitNotification };
