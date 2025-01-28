const mongoose = require('mongoose');

const callHistorySchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  startedAt: Date,
  endedAt: Date,
  duration: Number
});

module.exports = mongoose.model('CallHistory', callHistorySchema);
