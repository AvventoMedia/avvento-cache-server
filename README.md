# Avvento Cache Server

A Node.js server to fetch YouTube channel playlists and videos, cache them in **MongoDB**, and sync with **Firestore** for your Flutter app.

---

## Features

- Fetch YouTube playlists and playlist items (supports pagination)
- Cache data in MongoDB for fast API access
- Sync data to Firestore for app usage
- Cron job to update every 6 hours
- Fetch playlist items by channel or playlist ID

---

## Project Structure

avvento-cache-server/
├── .env # Stores API keys and MongoDB URI
├── package.json # Node project info + dependencies
├── server.js # Main Express server + cron job
├── fetchYouTube.js # Functions to fetch YouTube playlists/videos
└── models/
├── Playlist.js # MongoDB model for playlists
└── PlaylistItem.js


---

## Setup

1. Clone the repo:

```bash
git clone https://github.com/<your-username>/avvento-cache-server.git
cd avvento-cache-server


Install dependencies:

npm install


Create a .env file:

AVVENTOKIDS_APIKEY=your_key
AVVENTOKIDS_YT_CHANNEL_ID=your_channel_id
AVVENTOMUSIC_APIKEY=your_key
AVVENTOMUSIC_YT_CHANNEL_ID=your_channel_id
AVVENTOPRODUCTIONS_APIKEY=your_key
AVVENTOPRODUCTIONS_YT_CHANNEL_ID=your_channel_id
MONGO_URI=your_mongodb_connection_string
FIREBASE_SERVICE_ACCOUNT=./serviceAccountKey.json


Start the server locally:

npm start


Server runs on http://localhost:3000.

API Endpoints

Get playlists by channel:

GET /playlists/:channelName


Get playlist items by channel or playlist:

GET /playlistItems?channelName=AvventoMusic&playlistId=<playlistId>

Deployment

You can deploy on platforms like Render
, Railway
, or Vercel
.

Add environment variables in the hosting platform dashboard.

Make sure Firestore service account is available in production.

Cron Job

Runs every 6 hours to fetch and update new YouTube data automatically.