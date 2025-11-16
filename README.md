# Avvento Cache Server

A Node.js server to fetch YouTube channel playlists and videos, cache them in MongoDB, and sync with Firestore for your Flutter app.

## Features

- **Fetch YouTube playlists and playlist items** (supports pagination)
- **Cache playlists and videos in MongoDB** for fast API access
- **Sync MongoDB data to Firestore** for app usage
- **Automatic updates** via cron job (every 3 hours)
- **Incremental updates**: only new videos or changed views are updated
- **Playlist itemCount** is automatically synced to reflect the actual number of videos
- **Firestore-safe data conversion** (handles MongoDB ObjectId and Date fields)

## Project Structure

```plaintext
avvento-cache-server/
├── .env                       # Stores API keys, MongoDB URI, and Firebase service account
├── package.json                # Node project info + dependencies
├── server.js                   # Main Express server + cron job
├── fetchYouTube.js             # Functions to fetch YouTube playlists/videos and sync to Firestore
└── models/
    ├── Playlist.js             # MongoDB model for playlists
    └── PlaylistItem.js         # MongoDB model for playlist items
```

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/avvento-cache-server.git
cd avvento-cache-server
```

### 2. Install dependencies
```bash
npm install
```

### 3. Create a `.env` file
Create a `.env` file with the following environment variables:
```env
AVVENTOKIDS_APIKEY=your_key
AVVENTOKIDS_YT_CHANNEL_ID=your_channel_id

AVVENTOMUSIC_APIKEY=your_key
AVVENTOMUSIC_YT_CHANNEL_ID=your_channel_id

AVVENTOPRODUCTIONS_APIKEY=your_key
AVVENTOPRODUCTIONS_YT_CHANNEL_ID=your_channel_id

MONGO_URI=your_mongodb_connection_string
FIREBASE_SERVICE_ACCOUNT=./serviceAccountKey.json
```

### 4. Start the server locally
```bash
npm start
```
The server will run on http://localhost:3000.

## API Endpoints

### 1. Get Playlists by Channel

```http
GET /playlists/:channelName
```

Example: `/playlists/:channelName`

Returns all playlists cached in MongoDB for the specified channel.

Get playlist items by channel or playlist
```http
GET /playlistItems?channelName=:channelName
```
Returns playlist items for the given channel or playlist.

Supports filtering by channel or playlist ID.

## Fetching YouTube Data

- Playlists and playlist items are fetched from YouTube using the official YouTube Data API v3.
- Only new videos or videos with updated views are synced to MongoDB.
- Playlist `itemCount` in MongoDB is automatically updated after new videos are added.
- Firestore sync occurs incrementally after MongoDB updates, including updated `itemCount`.

## Firestore Sync

- Playlist and playlist items are converted to Firestore-safe objects before syncing.
- Removes MongoDB `_id` and `__v`, converts `Date` fields to ISO strings.
- Only updates Firestore if data is new or changed to avoid unnecessary writes.

## Cron Job

- Runs every 6 hours to fetch new YouTube data and sync to MongoDB & Firestore.
- Ensures your Flutter app always has the latest playlists and videos.
- Supports incremental updates to reduce API calls and server load.

## Deployment

- Can be deployed on platforms like **Render**, **Railway**, or **Vercel**.
- Add all environment variables in the platform dashboard.
- Ensure Firestore service account JSON is available in production.

## Notes / Best Practices

- Incremental updates ensure consistency without overwriting unchanged data.
- `itemCount` is synced with actual number of playlist items in MongoDB.
- Firestore sync ensures app clients get real-time updates with minimal latency.
- Running the full update every 3–6 hours is considered standard practice for cache servers.
