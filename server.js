require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cron = require('node-cron');
const { fetchPlaylists } = require('./fetchYouTube');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'));

const app = express();
app.use(express.json());

// Your 3 channels
const channels = [
  { name: 'AvventoKids', apiKey: process.env.AVVENTOKIDS_APIKEY, id: process.env.AVVENTOKIDS_YT_CHANNEL_ID },
  { name: 'AvventoMusic', apiKey: process.env.AVVENTOMUSIC_APIKEY, id: process.env.AVVENTOMUSIC_YT_CHANNEL_ID },
  { name: 'AvventoProductions', apiKey: process.env.AVVENTOPRODUCTIONS_APIKEY, id: process.env.AVVENTOPRODUCTIONS_YT_CHANNEL_ID },
];

// API to get playlists by channel (for your Flutter app)
app.get('/playlists/:channelName', async (req, res) => {
  const Playlist = require('./models/Playlist');
  const playlists = await Playlist.find({ channelName: req.params.channelName }).sort({ publishedAt: -1 });
  res.json(playlists);
});

// API to get playlist items by playlist ID
app.get('/playlistItems/:playlistId', async (req, res) => {
  const PlaylistItem = require('./models/PlaylistItem');
  const items = await PlaylistItem.find({ playlistId: req.params.playlistId }).sort({ publishedAt: -1 });
  res.json(items);
});

// API to get videos by channel (all videos across all playlists)
app.get('/videos/:channelName', async (req, res) => {
  const PlaylistItem = require('./models/PlaylistItem');
  const items = await PlaylistItem.find({ channelName: req.params.channelName }).sort({ publishedAt: -1 });
  res.json(items);
});

// Fetch a single video by YouTube video ID
app.get('/video/:videoId', async (req, res) => {
  const PlaylistItem = require('./models/PlaylistItem');
  try {
    const video = await PlaylistItem.findOne({ id: req.params.videoId });
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json(video);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});


// Add this after /playlists/:channelName
app.get('/playlistItems', async (req, res) => {
  const PlaylistItem = require('./models/PlaylistItem');

  const { channelName, playlistId } = req.query;
  const query = {};
  if (channelName) query.channelName = channelName;
  if (playlistId) query.playlistId = playlistId;

  try {
    const items = await PlaylistItem.find(query).sort({ publishedAt: -1 });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch playlist items' });
  }
});

(async () => {
  console.log('Fetching YouTube data for the first time...');
  for (const ch of channels) {
    await fetchPlaylists(ch.apiKey, ch.id, ch.name);
  }
  console.log('Initial fetch finished!');
})();


// Cron job: run every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('Updating YouTube data...');
  for (const ch of channels) {
    await fetchPlaylists(ch.apiKey, ch.id, ch.name);
  }
  console.log('Update finished!');
});

// Start server
app.listen(3000, () => console.log('Server running on port 3000'));
