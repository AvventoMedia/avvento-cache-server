require('dotenv').config();
const mongoose = require('mongoose');
const { fetchPlaylists, syncUpdatedMongoPlaylistsToFirestore } = require('./fetchYouTube');

const channels = [
  { name: 'AvventoKids', apiKey: process.env.AVVENTOKIDS_APIKEY, id: process.env.AVVENTOKIDS_YT_CHANNEL_ID },
  { name: 'AvventoMusic', apiKey: process.env.AVVENTOMUSIC_APIKEY, id: process.env.AVVENTOMUSIC_YT_CHANNEL_ID },
  { name: 'AvventoProductions', apiKey: process.env.AVVENTOPRODUCTIONS_APIKEY, id: process.env.AVVENTOPRODUCTIONS_YT_CHANNEL_ID },
];

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

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');
    
    await runFullYoutubeSync();
    
    console.log('Disconnecting from MongoDB...');
    await mongoose.disconnect();
    
    console.log('Exiting successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Fatal error during sync:', err);
    process.exit(1);
  }
}

start();
