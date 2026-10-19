require('dotenv').config();

/**
 * AzuraCast podcasts → Firestore `podcasts`.
 *
 * One document per show (the fields the app's RadioPodcast reads) and its
 * episodes in `podcasts/{id}/pages/{n}`, newest first, PAGE_SIZE per
 * page: a 748-episode show is 3 reads instead of 748, and every page stays
 * well under Firestore's 1 MB document limit. Uses the public endpoints,
 * whose audio and art need no key.
 *
 * Usage: node syncPodcasts.js [--dry-run]
 */

const { azuracastGet } = require('./azuracast');
const { syncDocs } = require('./firestoreSync');

const COLLECTION = 'podcasts';
const PAGE_SIZE = 250;

/** The fields RadioPodcast.fromJson reads. */
function toPodcastDoc(p) {
  return {
    id: p.id,
    title: p.title || '',
    description: p.description || '',
    author: p.author || '',
    email: p.email || '',
    is_published: !!p.is_published,
    episodes: p.episodes || 0,
    categories: p.categories || [],
    art_updated_at: p.art_updated_at || 0,
    links: { art: p.art || (p.links && p.links.art) || '', episodes: (p.links && p.links.episodes) || '' },
  };
}

/** The fields PodcastEpisode.fromJson reads. */
function toEpisode(e) {
  const media = e.playlist_media || {};
  const links = e.links || {};
  return {
    id: e.id,
    title: e.title || '',
    description: e.description || '',
    playlist_media: { artist: media.artist || '', album: media.album || '' },
    publish_at: e.publish_at || 0,
    links: { download: links.download || '', public: links.public || '', media: links.media || '' },
    is_published: !!e.is_published,
    art: e.art || '',
    episode_number: e.episode_number ?? null,
    season_number: e.season_number ?? null,
  };
}

/** Newest first, split into pages {"0": {page, episodes}, …}. */
function toPages(episodes) {
  const sorted = episodes.map(toEpisode).sort((a, b) => b.publish_at - a.publish_at);
  const pages = {};
  for (let i = 0; i * PAGE_SIZE < sorted.length; i++) {
    pages[String(i)] = { page: i, episodes: sorted.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE) };
  }
  return pages;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const podcasts = (await azuracastGet('/public/podcasts')).filter((p) => (p.episodes || 0) > 0);

  const shows = [];
  for (const p of podcasts) {
    const episodes = await azuracastGet(`/public/podcast/${p.id}/episodes`);
    const pages = toPages(episodes);
    shows.push({ doc: { ...toPodcastDoc(p), page_count: Object.keys(pages).length }, pages });
  }
  console.log(`🎧 ${shows.length} podcasts`);
  for (const s of shows) {
    const size = Math.max(0, ...Object.values(s.pages).map((pg) => JSON.stringify(pg).length));
    console.log(`  ${s.doc.episodes}\t${s.doc.title} · ${s.doc.page_count} pages · largest ${Math.round(size / 1024)} KB`);
  }
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }

  const { initializeFirebase } = require('./firebase');
  const firestore = initializeFirebase();
  const col = firestore.collection(COLLECTION);
  let written = 0;
  let deleted = 0;
  for (const s of shows) {
    const r = await syncDocs(firestore, col.doc(s.doc.id).collection('pages'), s.pages);
    written += r.written;
    deleted += r.deleted;
  }
  // Shows last, so the app never sees a show before its episodes.
  const r = await syncDocs(firestore, col, Object.fromEntries(shows.map((s) => [s.doc.id, s.doc])));
  console.log(`✅ Firestore: ${written + r.written} written, ${deleted + r.deleted} deleted`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Podcasts sync failed:', err.message);
      process.exit(1);
    });
}

module.exports = { toPodcastDoc, toEpisode, toPages, PAGE_SIZE };
