const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    allowedRoleId: { type: String, default: null },
    antiLinkEnabled: { type: Boolean, default: false },
    badWordsEnabled: { type: Boolean, default: false },
    badWords: { type: [String], default: [] },
    spamProtectionEnabled: { type: Boolean, default: false },
    spamThreshold: { type: Number, default: 5 },
    muteDuration: { type: Number, default: 10 } // in minutes
});

module.exports = mongoose.model('Config', configSchema);
