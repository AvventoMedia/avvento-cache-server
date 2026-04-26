const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const Playlist = require('./models/Playlist');
const PlaylistItem = require('./models/PlaylistItem');
const admin = require('firebase-admin');

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
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const firestore = admin.firestore();

const FORCE_PLAYLISTS = [
  {
    id: "PLpAaM9NDy5RuQwQon3qjSbL0gXU2AWFXH",
    channelName: "AvventoProductions",
    playlistTitle: "Julira Mukama"
  },
  {
    id: "PLpAaM9NDy5Rurk9LLOJUk0zWlfo9ZUSzg",
    channelName: "AvventoProductions",
    playlistTitle: "Bayibuli Egambaki"
  }
];

// Convert MongoDB playlist document to Firestore-safe object
function playlistToFirestore(playlist) {
  const { _id, __v, ...data } = playlist.toObject(); // remove _id & __v
  if (data.publishedAt instanceof Date) data.publishedAt = data.publishedAt.toISOString();
  if (data.lastUpdated instanceof Date) data.lastUpdated = data.lastUpdated.toISOString();
  if (data.latestPublishedAt instanceof Date) data.latestPublishedAt = data.latestPublishedAt.toISOString();
  return data;
}

// Convert MongoDB playlist item document to Firestore-safe object
function itemToFirestore(item) {
  const { _id, __v, ...data } = item.toObject();
  if (data.publishedAt instanceof Date) data.publishedAt = data.publishedAt.toISOString();
  return data;
}

/**
 * Format ISO 8601 duration from YouTube API to hh:mm:ss
 */
function formatDuration(duration, liveBroadcastContent) {
  if (liveBroadcastContent === 'live') return 'Live';
  if (liveBroadcastContent === 'upcoming') return 'Premiere';
  if (!duration || duration === 'P0D') return 'No Duration';

  let h = 0, m = 0, s = 0;
  duration = duration.replace('PT', '');
  if (duration.includes('H')) {
    const parts = duration.split('H');
    h = parseInt(parts[0]);
    duration = parts[1];
  }
  if (duration.includes('M')) {
    const parts = duration.split('M');
    m = parseInt(parts[0]);
    duration = parts.length > 1 ? parts[1] : '';
  }
  if (duration.includes('S')) {
    s = parseInt(duration.replace('S', ''));
  }

  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Sync all playlists from MongoDB to Firestore
 */
async function syncUpdatedMongoPlaylistsToFirestore(channelName) {
  const playlists = await Playlist.find({ channelName });

  for (const playlist of playlists) {
    const playlistDocRef = firestore
      .collection('playlists')
      .doc(channelName)
      .collection('channel')
      .doc(playlist.id);

    const firestoreItemsRef = playlistDocRef.collection('items');
    const firestoreItemsSnapshot = await firestoreItemsRef.get();

    if (playlist.itemCount === 0 || playlist.itemCount === '0') {
      // 0 items: delete from Firestore if it exists
      for (const doc of firestoreItemsSnapshot.docs) {
        await firestoreItemsRef.doc(doc.id).delete();
      }
      await playlistDocRef.delete();
      console.log(`🗑️ Deleted playlist with 0 items: ${playlist.title} from Firestore.`);
      continue;
    }

    const playlistData = playlistToFirestore(playlist);
    playlistData.itemCount = playlist.itemCount;

    // Always merge playlist metadata (title, thumbnail, itemCount, etc.)
    await playlistDocRef.set(playlistData, { merge: true });

    const items = await PlaylistItem.find({ playlistId: playlist.id});
    const mongoItemIds = new Set(items.map(item => item.id));

    // Delete items in Firestore that are no longer in MongoDB
    for (const doc of firestoreItemsSnapshot.docs) {
      if (!mongoItemIds.has(doc.id)) {
        await firestoreItemsRef.doc(doc.id).delete();
        console.log(`🗑️ Deleted removed item ${doc.id} from Firestore`);
      }
    }

    // Sync only new/updated items
    for (const item of items) {
      const itemData = itemToFirestore(item);
      // Overwrite item completely so metadata stays fresh
      await firestoreItemsRef.doc(item.id).set(itemData);
      console.log(`Updated item ${item.id} in Firestore`);
    }
    // After syncing ALL new items
    await Playlist.updateOne({ id: playlist.id },{ lastSyncedAt: new Date() });
    console.log(`Playlist ${playlist.title} synced successfully.`);
  }
}

/**
 * Fetch playlist metadata by ID
 */
async function fetchPlaylistById(apiKey, playlistId) {
  const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${playlistId}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.items?.[0] || null;
}

/**
 * Fetch playlists from YouTube and update MongoDB only
 */
async function fetchPlaylists(apiKey, channelId, channelName) {

    // Fetch ONLY one page (last 50 playlists)
  const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${channelId}&maxResults=50&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    const fetchedIds = new Set();

    for (const playlist of data.items || []) {
      fetchedIds.add(playlist.id);
      await processPlaylist(apiKey, playlist, channelName);
    }


  // FORCE PLAYLISTS (with their own channelName mapping)
  for (const forced of FORCE_PLAYLISTS) {
    if (fetchedIds.has(forced.id)) continue;

    console.log(`⚠️ Force-fetching ${forced.id} for channel ${forced.channelName}`);

    const playlist = await fetchPlaylistById(apiKey, forced.id);

    if (playlist) {
      await processPlaylist(apiKey, playlist, forced.channelName);
    }
  }
}

/**
 * Save playlist + fetch items
 */
async function processPlaylist(apiKey, playlist, channelName) {
  const playlistThumbnail =
    playlist.snippet.thumbnails?.maxres?.url ||
    playlist.snippet.thumbnails?.standard?.url ||
    playlist.snippet.thumbnails?.high?.url || "";

  const existing = await Playlist.findOne({ id: playlist.id });

  const lastUpdated = existing?.lastUpdated || new Date(0);
  const latestPublishedAt = existing?.latestPublishedAt
    ? existing.latestPublishedAt
    : new Date(playlist.snippet.publishedAt);

  // Prevents wrong channel mixing
  // -------------------------------
  if (existing && existing.channelName !== channelName) {
    console.log(`⚠️ Correcting playlist owner → ${channelName}`);
  }
  // -------------------------------

  // MongoDB: Upsert playlist
  await Playlist.updateOne(
    { id: playlist.id },
    {
      id: playlist.id,
      title: playlist.snippet.title,
      description: playlist.snippet.description,
      publishedAt: new Date(playlist.snippet.publishedAt),
      thumbnailUrl: playlistThumbnail,
      channelTitle: playlist.snippet.channelTitle,
      channelName,
      itemCount: playlist.contentDetails.itemCount,
      latestPublishedAt,
    },
    { upsert: true }
  );

  // Fetch videos
  await fetchPlaylistItems(apiKey,
    playlist.id,
    channelName,
    playlist.snippet.channelTitle,
    latestPublishedAt,
    playlist.snippet.title
  );

  await Playlist.updateOne({ id: playlist.id }, { lastUpdated: new Date() });
}

/**
 * Fetch playlist items and update MongoDB only
 */
async function fetchPlaylistItems(apiKey, playlistId, channelName, channelTitle, lastPublishedAt, playlistTitle) {
  let nextPageToken = '';
  let newestPublishedAt = lastPublishedAt;
  const fetchedVideoIds = new Set();

  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&maxResults=50&playlistId=${playlistId}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    for (const item of data.items || []) {
      if (item.snippet.title === 'Private video' || item.snippet.title === 'Deleted video') continue;

      const publishedAt = new Date(item.snippet.publishedAt);
      // Do NOT skip older videos — we want to refresh views & duration.
      if (publishedAt > newestPublishedAt) newestPublishedAt = publishedAt;

      const videoId = item.snippet.resourceId?.videoId || item.id;
      fetchedVideoIds.add(videoId);

      // Fetch video details
      const videoRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet,status&id=${videoId}&key=${apiKey}`
      );
      const videoData = await videoRes.json();
      const videoDetails = videoData.items?.[0];
      if (!videoDetails) continue;

      const thumbnailUrl =
        item.snippet.thumbnails?.maxres?.url ||
        item.snippet.thumbnails?.standard?.url ||
        item.snippet.thumbnails?.high?.url ||
        '';

      const views = videoDetails.statistics?.viewCount || 0;
      // Check MongoDB for existing video
      const existingVideo = await PlaylistItem.findOne({ id: videoId });

      const hasChanges =
      !existingVideo ||
      existingVideo.views !== views ||
      existingVideo.duration !== formatDuration(videoDetails.contentDetails.duration, videoDetails.snippet.liveBroadcastContent) ||
      existingVideo.title !== item.snippet.title;

      if (hasChanges) {
        // MongoDB: Upsert video
        await PlaylistItem.updateOne(
          { id: videoId },
          {
            id: videoId,
            playlistId,
            title: item.snippet.title,
            description: item.snippet.description,
            publishedAt,
            thumbnailUrl,
            duration: formatDuration(videoDetails.contentDetails.duration, videoDetails.snippet.liveBroadcastContent),
            views,
            liveBroadcastContent: videoDetails.snippet.liveBroadcastContent,
            privacyStatus: videoDetails.status?.privacyStatus || 'public',
            channelTitle,
            channelName,
          },
          { upsert: true }
        );
      }
    }

    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  // Remove videos from MongoDB that are no longer in the playlist (e.g. made private/deleted/removed)
  const deleteResult = await PlaylistItem.deleteMany({
    playlistId: playlistId,
    id: { $nin: Array.from(fetchedVideoIds) }
  });
  if (deleteResult.deletedCount > 0) {
    console.log(`🗑️ Removed ${deleteResult.deletedCount} private/deleted/missing videos from playlist ${playlistTitle} in MongoDB`);
  }

  // Update latestPublishedAt
  if (newestPublishedAt > lastPublishedAt) {
    await Playlist.updateOne({ id: playlistId }, { latestPublishedAt: newestPublishedAt });
    console.log(`Updated latestPublishedAt for playlist ${playlistTitle}: ${playlistId}: ${lastPublishedAt} from ${channelName} channel to MongoDB`);
  }

// ✅ Update itemCount after all items are processed
  const totalItems = await PlaylistItem.countDocuments({ playlistId });
  await Playlist.updateOne({ id: playlistId }, { itemCount: totalItems });
}

/**
 * Fetch channel statistics and securely push directly to Firestore
 */
async function syncChannelStatsToFirestore(channelName, apiKey, channelId) {
  if (!apiKey || !channelId) {
    console.error(`❌ Missing API Key or Channel ID for ${channelName}!`);
    return;
  }

  const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  
  if (data.items && data.items.length > 0) {
    const stats = data.items[0].statistics;
    
    // Write directly to firestore
    await firestore.collection('statistics').doc('youtube').set({
      [channelName]: {
        subscribers: stats.subscriberCount,
        views: stats.viewCount,
        videos: stats.videoCount,
        updatedAt: new Date().toISOString()
      }
    }, { merge: true });
    
    console.log(`📊 Synced stats for ${channelName} to Firestore.`);
  } else {
    console.error(`❌ Failed to sync stats for ${channelName}. API returned:`, JSON.stringify(data, null, 2));
  }
}

module.exports = { fetchPlaylists, syncUpdatedMongoPlaylistsToFirestore, syncChannelStatsToFirestore };
