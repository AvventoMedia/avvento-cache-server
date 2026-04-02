# Avvento Cache Server (Serverless Sync)

A serverless background worker powered by GitHub Actions that fetches YouTube channel playlists and videos, caches them in MongoDB, and syncs them automatically with Firestore for the Flutter app.

## Features

- **Automated YouTube Fetching**: Retrieves playlists and videos (supports pagination).
- **MongoDB Caching**: Caches videos in MongoDB to act as a staging database.
- **Firestore Syncing**: Automatically synchronizes new and updated data safely to Firestore.
- **Serverless Architecture**: Runs automatically via GitHub Actions—100% free and requires no active API servers (unlike sleeping free-tier hosting).
- **Incremental Updates**: Intelligently updates only new videos or changed views to minimize database writes.

## Project Structure

```plaintext
avvento-cache-server/
├── .github/workflows/          
│   └── sync.yml                # GitHub Actions workflow (runs every 3 hours)
├── .env                        # Local storage for API keys (Ignored by git)
├── package.json                # Node dependencies
├── sync.js                     # Main executable script for the background worker
├── fetchYouTube.js             # Core logic to fetch from YouTube and sync
└── models/
    ├── Playlist.js             # MongoDB model for playlists
    └── PlaylistItem.js         # MongoDB model for playlist items
```

## Setup & Local Development

### 1. Clone the repository

```bash
git clone https://github.com/AvventoMedia/avvento-cache-server.git
cd avvento-cache-server
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file locally with your credentials:
```env
AVVENTOKIDS_APIKEY=your_key
AVVENTOKIDS_YT_CHANNEL_ID=your_channel_id

AVVENTOMUSIC_APIKEY=your_key
AVVENTOMUSIC_YT_CHANNEL_ID=your_channel_id

AVVENTOPRODUCTIONS_APIKEY=your_key
AVVENTOPRODUCTIONS_YT_CHANNEL_ID=your_channel_id

MONGO_URI=your_mongodb_connection_string

# For Firebase, paste the plain JSON blob, OR a Base64 encoded string
FIREBASE_SERVICE_ACCOUNT=your_firebase_json_or_base64
```

### 4. Run the sync locally
```bash
npm start
```
This command triggers `node sync.js`, runs one complete fetch and sync loop, and cleanly exits.

## Production / Deployment (GitHub Actions)

This project does **not** need to be deployed to a traditional hosting provider like Render or Vercel. It runs natively and automatically within **GitHub Actions**.

### How to configure:
1. Go to your GitHub Repository > **Settings** > **Secrets and variables** > **Actions**.
2. Click **New repository secret**.
3. Add **all** environment variables listed above (e.g. `MONGO_URI`, `AVVENTOKIDS_APIKEY`, etc.).
   *(Note: For `FIREBASE_SERVICE_ACCOUNT`, you can paste the JSON exactly as-is, or encode it to Base64 to strictly prevent multiline formatting bugs in GitHub).*
4. Configure your database network permissions. Since GitHub Actions servers rotate IPs dynamically, you must whitelist `0.0.0.0/0` (Allow Access From Anywhere) in your **MongoDB Atlas Network Access** panel.

### Triggering the Sync:
- **Automatic**: The `.github/workflows/sync.yml` file dictates that the worker runs exactly every 3 hours.
- **Manual**: Go to the **Actions** tab in GitHub, select **YouTube to Firestore Sync**, and click **Run workflow**.

## Data Sync Logic

1. **Fetch**: Reaches out to the YouTube Data API v3 for the latest playlist and video metrics.
2. **Transform**: Formats durations (from ISO 8601 to strings) and safely strips MongoDB specific IDs.
3. **MongoDB Upsert**: Updates MongoDB if an item has changed, skipping untouched documents to save bandwidth.
4. **Firestore Push**: Reads the freshly mutated MongoDB documents and patches the connected Firestore database automatically. 
