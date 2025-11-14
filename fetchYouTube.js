const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const Playlist = require('./models/Playlist');
const PlaylistItem = require('./models/PlaylistItem');
// Firebase Admin Setup
const admin = require('firebase-admin');

const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT); // Path to your JSON key

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const firestore = admin.firestore();

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

  if (h > 0) return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

/**
 * Fetch all playlists for a channel with pagination
 */
async function fetchPlaylists(apiKey, channelId, channelName) {
  let nextPageToken = '';

  do {
    // YouTube API supports paging using pageToken
    const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${channelId}&maxResults=50${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    // Loop through each playlist
    for (const playlist of data.items || []) {
      const playlistThumbnail =
      playlist.snippet.thumbnails?.maxres?.url ||
      playlist.snippet.thumbnails?.standard?.url ||
      playlist.snippet.thumbnails?.high?.url ||
      '';

      await Playlist.updateOne({ id: playlist.id }, {
        id: playlist.id,
        title: playlist.snippet.title,
        description: playlist.snippet.description,
        publishedAt: new Date(playlist.snippet.publishedAt),
        thumbnailUrl: playlistThumbnail,
        channelTitle: playlist.snippet.channelTitle,
        channelName,
        itemCount: playlist.contentDetails.itemCount,
      }, { upsert: true });

   
      // Firestore: Save playlist under playlists/channelName/channel/playlistId
      await firestore
        .collection('playlists')
        .doc(channelName)
        .collection('channel')
        .doc(playlist.id)
        .set({
          id: playlist.id,
          title: playlist.snippet.title,
          description: playlist.snippet.description,
          publishedAt: playlist.snippet.publishedAt,
          thumbnailUrl: playlistThumbnail,
          channelTitle: playlist.snippet.channelTitle,
          itemCount: playlist.contentDetails.itemCount,
        }, { merge: true });


      // Fetch videos for each playlist
      await fetchPlaylistItems(apiKey, playlist.id, channelName, playlist.snippet.channelTitle);
    }

    nextPageToken = data.nextPageToken; // Update token for next page
  } while (nextPageToken); // Repeat until all pages fetched
}

/**
 * Fetch all videos in a playlist (pagination supported)
 */
async function fetchPlaylistItems(apiKey, playlistId, channelName, channelTitle) {
  let nextPageToken = '';

  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&maxResults=50&playlistId=${playlistId}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    for (const item of data.items || []) {
      if (item.snippet.title === 'Private video') continue;
      const videoId = item.snippet.resourceId?.videoId || item.id;

      // Fetch video details (duration, views, live status)
      const videoRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet,status&id=${videoId}&key=${apiKey}`);
      const videoData = await videoRes.json();
      const videoDetails = videoData.items?.[0];
      if (!videoDetails) continue;

      const thumbnailUrl =
      item.snippet.thumbnails?.maxres?.url ||
      item.snippet.thumbnails?.standard?.url ||
      item.snippet.thumbnails?.high?.url ||
      '';

      await PlaylistItem.updateOne({ id: videoId }, {
        id: videoId,
        playlistId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: new Date(item.snippet.publishedAt),
        thumbnailUrl,
        duration: formatDuration(videoDetails.contentDetails.duration, videoDetails.snippet.liveBroadcastContent),
        views: videoDetails.statistics?.viewCount || 0,
        liveBroadcastContent: videoDetails.snippet.liveBroadcastContent,
        privacyStatus: videoDetails.status?.privacyStatus || 'public',
        channelTitle,
        channelName,
      }, { upsert: true });

      // Firestore: Save video under playlists/channelName/channel/playlistId/items/videoId
      await firestore
        .collection('playlists')
        .doc(channelName)
        .collection('channel')
        .doc(playlistId)
        .collection('items')
        .doc(videoId)
        .set({
          id: videoId,
          playlistId,
          title: item.snippet.title,
          description: item.snippet.description,
          publishedAt: item.snippet.publishedAt,
          thumbnailUrl,
          duration: formatDuration(videoDetails.contentDetails.duration, videoDetails.snippet.liveBroadcastContent),
          views: videoDetails.statistics?.viewCount || 0,
          liveBroadcastContent: videoDetails.snippet.liveBroadcastContent,
          privacyStatus: videoDetails.status?.privacyStatus || 'public',
          channelTitle,
          channelName,
        }, { merge: true });
    }

    
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);
}

module.exports = { fetchPlaylists };
