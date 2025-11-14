const mongoose = require('mongoose');

const PlaylistItemSchema = new mongoose.Schema({
  id: String,
  playlistId: String,
  videoId: String,                // YouTube video ID
  title: String,
  description: String,
  thumbnailUrl: String,           // Add thumbnail
  publishedAt: Date,
  duration: String,               // Formatted duration like "05:32"
  views: String,                  // Store as string to match your Flutter class
  liveBroadcastContent: String,   // "live", "upcoming", or ""
  privacyStatus: String,          // "public", "private"
  channelTitle: String,
  channelName: String,
});

module.exports = mongoose.model('PlaylistItem', PlaylistItemSchema);
