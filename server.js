require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cron = require('node-cron');
const { fetchPlaylists, syncUpdatedMongoPlaylistsToFirestore } = require('./fetchYouTube');

const Playlist = require('./models/Playlist');
const PlaylistItem = require('./models/PlaylistItem');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'));

const app = express();
app.use(express.json());

const channels = [
  { name: 'AvventoKids', apiKey: process.env.AVVENTOKIDS_APIKEY, id: process.env.AVVENTOKIDS_YT_CHANNEL_ID },
  { name: 'AvventoMusic', apiKey: process.env.AVVENTOMUSIC_APIKEY, id: process.env.AVVENTOMUSIC_YT_CHANNEL_ID },
  { name: 'AvventoProductions', apiKey: process.env.AVVENTOPRODUCTIONS_APIKEY, id: process.env.AVVENTOPRODUCTIONS_YT_CHANNEL_ID },
];

// APIs
app.get('/playlists/:channelName', async (req, res) => {
  const playlists = await Playlist.find({ channelName: req.params.channelName }).sort({ publishedAt: -1 });
  res.json(playlists);
});

app.get('/playlistItems/:playlistId', async (req, res) => {
  const items = await PlaylistItem.find({ playlistId: req.params.playlistId }).sort({ publishedAt: -1 });
  res.json(items);
});

app.get('/videos/:channelName', async (req, res) => {
  const items = await PlaylistItem.find({ channelName: req.params.channelName }).sort({ publishedAt: -1 });
  res.json(items);
});

app.get('/video/:videoId', async (req, res) => {
  try {
    const video = await PlaylistItem.findOne({ id: req.params.videoId });
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json(video);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// Fetch from YouTube -> MongoDB -> Firestore (initial)
// (async () => {
//   console.log('Fetching YouTube data for the first time...');
//   for (const ch of channels) {
//     await fetchPlaylists(ch.apiKey, ch.id, ch.name);
//     await syncUpdatedMongoPlaylistsToFirestore(ch.name); // Sync Mongo -> Firestore
//   }
//   console.log('Initial fetch finished!');
// })();

// Cron: update every 3 hours
cron.schedule('0 */3 * * *', async () => {
  console.log('Updating YouTube data...');
  for (const ch of channels) {
    await fetchPlaylists(ch.apiKey, ch.id, ch.name);
    await syncUpdatedMongoPlaylistsToFirestore(ch.name);
  }
  console.log('Update finished!');
});

app.listen(3000, () => console.log('Server running on port 3000'));
