require('dotenv').config();
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const Playlist = require('./models/Playlist');
const PlaylistItem = require('./models/PlaylistItem');

function initializeFirebase() {
  if (admin.apps.length) return admin.firestore();

  const rawFirebaseEnv = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if (!rawFirebaseEnv) throw new Error("🚨 FIREBASE_SERVICE_ACCOUNT environment variable is completely empty or missing!");
  
  let serviceAccount;
  try {
    if (rawFirebaseEnv.trim().startsWith('{')) {
      serviceAccount = JSON.parse(rawFirebaseEnv);
    } else {
      serviceAccount = JSON.parse(Buffer.from(rawFirebaseEnv, 'base64').toString('utf8'));
    }
    
    // Safely fix escaped newlines inside the private key so Firebase auth doesn't crash with 16 UNAUTHENTICATED
    if (serviceAccount && serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } catch (e) {
    throw new Error(`🚨 FIREBASE_SERVICE_ACCOUNT exists but contains invalid JSON. Length: ${rawFirebaseEnv.length}`);
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin.firestore();
}

function getHighlightType(channelName) {
  if (channelName === 'AvventoMusic') return 'Music';
  if (channelName === 'AvventoKids') return 'Kids';
  if (channelName === 'AvventoProductions') return 'Avvento';
  return 'Avvento'; // Fallback
}

function itemToYoutubeJson(item) {
  const data = item.toObject ? item.toObject() : item;
  return {
    id: data.id,
    snippet: {
      title: data.title,
      description: data.description || '',
      channelTitle: data.channelTitle || '',
      publishedAt: data.publishedAt instanceof Date ? data.publishedAt.toISOString() : data.publishedAt,
      thumbnails: {
        maxres: { url: data.thumbnailUrl }
      },
      resourceId: { videoId: data.id },
      liveBroadcastContent: data.liveBroadcastContent || ''
    },
    contentDetails: {
      duration: data.duration || ''
    },
    status: {
      privacyStatus: data.privacyStatus || ''
    }
  };
}

function playlistToYoutubeJson(playlist) {
  const data = playlist.toObject ? playlist.toObject() : playlist;
  return {
    id: data.id,
    snippet: {
      title: data.title,
      description: data.description || '',
      publishedAt: data.publishedAt instanceof Date ? data.publishedAt.toISOString() : data.publishedAt,
      thumbnails: {
        maxres: { url: data.thumbnailUrl }
      }
    },
    contentDetails: {
      itemCount: data.itemCount || 0
    }
  };
}

async function updateHighlights() {
  console.log("🔄 Starting automated weekly highlights generator...");
  
  const firestore = initializeFirebase();

  // Always pull the absolute latest 9 videos and 3 playlists
  console.log(`➡️ Querying MongoDB for latest content...`);

  const allRecentVideos = await PlaylistItem.find().sort({ publishedAt: -1 }).limit(50);
  
  const recentVideos = [];
  const seenPlaylistIds = new Set();
  for (const video of allRecentVideos) {
    if (!seenPlaylistIds.has(video.playlistId)) {
      recentVideos.push(video);
      seenPlaylistIds.add(video.playlistId);
      if (recentVideos.length >= 9) break;
    }
  }

  const recentPlaylists = await Playlist.find().sort({ publishedAt: -1 }).limit(3);

  const highlights = [];
  const catchyTitles = ["FEATURED", "NEW", "PREMIERE", "DON'T MISS", "MUST WATCH", "TRENDING"];

  for (const video of recentVideos) {
    const randomCatchyTitle = catchyTitles[Math.floor(Math.random() * catchyTitles.length)];
    highlights.push({
      title: randomCatchyTitle,
      name: video.title,
      imageUrl: video.thumbnailUrl,
      type: getHighlightType(video.channelName),
      publishedAt: admin.firestore.Timestamp.fromDate(video.publishedAt),
      youtubePlaylistItem: itemToYoutubeJson(video),
      youtubePlaylist: null,
      automated: true
    });
  }

  for (const playlist of recentPlaylists) {
    const randomCatchyTitle = catchyTitles[Math.floor(Math.random() * catchyTitles.length)];
    highlights.push({
      title: randomCatchyTitle,
      name: playlist.title,
      imageUrl: playlist.thumbnailUrl,
      type: getHighlightType(playlist.channelName),
      publishedAt: admin.firestore.Timestamp.fromDate(playlist.publishedAt),
      youtubePlaylistItem: null,
      youtubePlaylist: playlistToYoutubeJson(playlist),
      automated: true
    });
  }

  if (highlights.length === 0) {
    console.log("⚠️ No new content found in the last 7 days. Exiting without modifying highlights.");
    return;
  }

  console.log(`➡️ Found ${recentVideos.length} videos and ${recentPlaylists.length} playlists for highlights.`);

  const highlightsCollection = firestore.collection('highlights');

  // Find and safely remove old automated highlights
  const oldHighlightsSnapshot = await highlightsCollection.where('automated', '==', true).get();
  
  const batch = firestore.batch();
  let deletedCount = 0;
  for (const doc of oldHighlightsSnapshot.docs) {
    batch.delete(doc.ref);
    deletedCount++;
  }
  console.log(`🗑️ Deleting ${deletedCount} previous automated highlights...`);

  // Insert new automated highlights
  let addedCount = 0;
  for (const highlight of highlights) {
    const docRef = highlightsCollection.doc();
    batch.set(docRef, highlight);
    addedCount++;
  }
  console.log(`✨ Adding ${addedCount} new automated highlights...`);

  await batch.commit();

  console.log("🎉 Successfully updated automated highlights!");
}

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');
    
    await updateHighlights();
    
    console.log('Disconnecting from MongoDB...');
    await mongoose.disconnect();
    
    console.log('Exiting successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Fatal error during highlight generation:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { updateHighlights };
