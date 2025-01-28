const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: String,
  timestamp: Date
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
