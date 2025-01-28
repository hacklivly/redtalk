require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const requestIp = require('request-ip');
const geoip = require('geoip-lite');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Database Models
const User = require('./models/User');
const CallHistory = require('./models/CallHistory');
const Report = require('./models/Report');
const ChatMessage = require('./models/ChatMessage');

// Middleware
app.use(express.json());
app.use(requestIp.mw());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// JWT Authentication Middleware
const authenticate = (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = decoded;
    next();
  });
};

// User Matching Pool
let matchingPool = [];

io.use(authenticate).on('connection', (socket) => {
  console.log(`User connected: ${socket.user.username}`);
  
  // Get user country from IP
  const geo = geoip.lookup(socket.handshake.address);
  const country = geo?.country || 'US';
  
  // Add user to matching pool
  socket.on('join-pool', (filters = {}) => {
    matchingPool.push({
      socketId: socket.id,
      userId: socket.user.id,
      country,
      filters
    });
    attemptMatch(socket);
  });

  // WebRTC Signaling
  socket.on('offer', (data) => {
    io.to(data.to).emit('offer', { ...data, from: socket.id });
  });

  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate', data.candidate);
  });

  // Chat Messages
  socket.on('chat-message', async (message) => {
    const chatMessage = new ChatMessage({
      from: socket.user.id,
      to: getPeerId(socket.id),
      message,
      timestamp: new Date()
    });
    await chatMessage.save();
    
    io.to(socket.id).emit('chat-message', chatMessage);
    io.to(getPeerId(socket.id)).emit('chat-message', chatMessage);
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    matchingPool = matchingPool.filter(user => user.socketId !== socket.id);
    console.log(`User disconnected: ${socket.user.username}`);
  });
});

// User Matching Logic
function attemptMatch(socket) {
  const currentUser = matchingPool.find(u => u.socketId === socket.id);
  const candidates = matchingPool.filter(u => 
    u.socketId !== socket.id &&
    (currentUser.filters.country ? u.country === currentUser.filters.country : true)
  );

  if (candidates.length > 0) {
    const matchedUser = candidates[0];
    matchingPool = matchingPool.filter(u => 
      u.socketId !== socket.id && u.socketId !== matchedUser.socketId
    );

    // Create call history record
    const call = new CallHistory({
      participants: [currentUser.userId, matchedUser.userId],
      startedAt: new Date()
    });
    call.save();

    // Notify both users
    io.to(socket.id).emit('matched', { 
      peer: matchedUser.socketId,
      country: matchedUser.country,
      callId: call._id
    });
    
    io.to(matchedUser.socketId).emit('matched', { 
      peer: socket.id,
      country: currentUser.country,
      callId: call._id
    });
  }
}

// REST API Routes
app.post('/api/register', async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.status(201).send({ user, token });
  } catch (error) {
    res.status(400).send(error);
  }
});

app.post('/api/report', async (req, res) => {
  try {
    const report = new Report({
      reporter: req.body.reporterId,
      reportedUser: req.body.reportedUserId,
      reason: req.body.reason,
      timestamp: new Date()
    });
    await report.save();
    res.status(201).send(report);
  } catch (error) {
    res.status(400).send(error);
  }
});

app.get('/api/call-history/:userId', async (req, res) => {
  try {
    const history = await CallHistory.find({
      participants: req.params.userId
    }).populate('participants');
    res.send(history);
  } catch (error) {
    res.status(500).send(error);
  }
});

server.listen(3000, () => console.log('Server running on port 3000'));
