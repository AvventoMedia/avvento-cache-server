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

app.get('/sync', async (req, res) => {
  console.log("Manually triggered sync");
  await runFullYoutubeSync();
  res.send("Sync completed");
});


// Reusable sync function
async function runFullYoutubeSync() {
  console.log("🔄 Starting YouTube → MongoDB → Firestore sync...");

  for (const ch of channels) {
    try {
      console.log(`➡️ Fetching playlists for: ${ch.name}`);
      await fetchPlaylists(ch.apiKey, ch.id, ch.name);

      console.log(`➡️ Syncing Mongo → Firestore for: ${ch.name}`);
      await syncUpdatedMongoPlaylistsToFirestore(ch.name);

      console.log(`✅ Completed: ${ch.name}`);
    } catch (err) {
      console.error(`❌ Error syncing ${ch.name}:`, err.message);
    }
  }

  console.log("🎉 Full sync finished!");
}


// Fetch from YouTube -> MongoDB -> Firestore (initial)
(async () => {
  console.log('Fetching YouTube data for the first time...');
  for (const ch of channels) {
    await fetchPlaylists(ch.apiKey, ch.id, ch.name);
    await syncUpdatedMongoPlaylistsToFirestore(ch.name); // Sync Mongo -> Firestore
  }
  console.log('Initial fetch finished!');
})();

app.listen(3000, () => console.log('Server running on port 3000'));
