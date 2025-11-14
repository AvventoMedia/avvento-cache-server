const mongoose = require('mongoose');

const PlaylistSchema = new mongoose.Schema({
  id: String,                // Playlist ID from YouTube
  title: String,             // Playlist title
  description: String,       // Playlist description
  publishedAt: Date,         // Playlist publish date
  thumbnailUrl: String,
  channelTitle: String,      // YouTube channel title
  channelName: String,     // YouTube channel name
  itemCount: Number,         // Number of videos in playlist
});

// Export model to use in other files
module.exports = mongoose.model('Playlist', PlaylistSchema);
