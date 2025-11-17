const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const Playlist = require('./models/Playlist');
const PlaylistItem = require('./models/PlaylistItem');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const firestore = admin.firestore();

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
    const playlistData = playlistToFirestore(playlist);

    // Firestore document reference
    const playlistDocRef = firestore
      .collection('playlists')
      .doc(channelName)
      .collection('channel')
      .doc(playlist.id);

    // Check if Firestore already has this playlist
    const doc = await playlistDocRef.get();
    // Only update if Firestore missing or MongoDB has newer info
    if (!doc.exists || (playlist.latestPublishedAt && new Date(playlist.latestPublishedAt) > new Date(doc.data().latestPublishedAt || 0))) {
      await playlistDocRef.set(playlistData, { merge: true });
      console.log(`Updated playlist ${playlist.title}: ${playlist.id} in Firestore`);
    }

    // Sync only new items
    const items = await PlaylistItem.find({ playlistId: playlist.id, publishedAt: { $gt: playlist.lastSyncedAt || new Date(0) } });

    for (const item of items) {
      const itemData = itemToFirestore(item);
      await playlistDocRef.collection('items').doc(item.id).set(itemData, { merge: true });
      console.log(`Updated item ${item.id} in Firestore`);
    }
    // After syncing ALL new items
    await Playlist.updateOne({ id: playlist.id },{ lastSyncedAt: new Date() });
    console.log(`Playlist ${playlist.title} synced successfully.`);
  }
}


/**
 * Fetch playlists from YouTube and update MongoDB only
 */
async function fetchPlaylists(apiKey, channelId, channelName) {

    // Fetch ONLY one page (last 50 playlists)
  const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${channelId}&maxResults=50&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    for (const playlist of data.items || []) {
      const playlistThumbnail =
        playlist.snippet.thumbnails?.maxres?.url ||
        playlist.snippet.thumbnails?.standard?.url ||
        playlist.snippet.thumbnails?.high?.url ||
        '';

      const existingPlaylist = await Playlist.findOne({ id: playlist.id });
      const lastUpdated = existingPlaylist?.lastUpdated || new Date(0);
      const latestPublishedAt = existingPlaylist?.latestPublishedAt ? existingPlaylist.latestPublishedAt || playlist.snippet.publishedAt : new Date(playlist.snippet.publishedAt);

      // If playlist hasn't changed since last fetch, skip fetching items
      if (existingPlaylist && new Date(playlist.snippet.publishedAt) <= lastUpdated) {
        console.log(`No updates for playlist ${playlist.snippet.title}, skipping fetching items.`);
        continue; // skip to next playlist
      }

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

      // Fetch new videos only
      await fetchPlaylistItems(apiKey, playlist.id, channelName, playlist.snippet.channelTitle, latestPublishedAt, playlist.snippet.title);

      // Update lastUpdated
      await Playlist.updateOne({ id: playlist.id }, { lastUpdated: new Date() });
    }
}

/**
 * Fetch playlist items and update MongoDB only
 */
async function fetchPlaylistItems(apiKey, playlistId, channelName, channelTitle, lastPublishedAt, playlistTitle) {
  let nextPageToken = '';
  let newestPublishedAt = lastPublishedAt;

  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&maxResults=50&playlistId=${playlistId}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    for (const item of data.items || []) {
      if (item.snippet.title === 'Private video') continue;

      const publishedAt = new Date(item.snippet.publishedAt);
      if (publishedAt <= lastPublishedAt) continue;
      if (publishedAt > newestPublishedAt) newestPublishedAt = publishedAt;

      const videoId = item.snippet.resourceId?.videoId || item.id;

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

       // Only update if new or views changed
      if (!existingVideo || publishedAt > lastPublishedAt || existingVideo.views !== views) {
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

  // Update latestPublishedAt
  if (newestPublishedAt > lastPublishedAt) {
    await Playlist.updateOne({ id: playlistId }, { latestPublishedAt: newestPublishedAt });
    console.log(`Updated latestPublishedAt for playlist ${playlistTitle}: ${playlistId}: ${lastPublishedAt} from ${channelName} channel to MongoDB`);
  }

  // ✅ Update itemCount after all items are processed
  const totalItems = await PlaylistItem.countDocuments({ playlistId });
  await Playlist.updateOne({ id: playlistId }, { itemCount: totalItems });
}

module.exports = { fetchPlaylists, syncUpdatedMongoPlaylistsToFirestore };
