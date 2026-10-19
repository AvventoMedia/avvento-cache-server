require('dotenv').config();

/**
 * AzuraCast media library → Firestore `presenters`.
 *
 * Presenters are the artists with a title (Pr., Ev., Elder, Bro., Sis.,
 * Dr.). An album with two or more of their files is a series (parts in
 * "Pt. N" order); the rest are single sermons, newest first. Sermons use
 * AzuraCast's podcast-episode shape so the app parses them unchanged.
 *
 * Usage: node syncPresenters.js [--dry-run]
 */

const { azuracastGet } = require('./azuracast');
const { syncDocs } = require('./firestoreSync');

const COLLECTION = 'presenters';

const PRESENTER = /^(Pr|Ev|Elder|Bro|Sis|Dr|Pastor)\.?\s+\S/;
const PART = /\b(?:pt|part)\.?\s*(\d+)/i;

const slug = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

/** "Pt. 1 - Busy Here and There (Busy Here and There)" → drop "(album)". */
function cleanTitle(title, album) {
  const t = (title || '').trim();
  if (!album) return t;
  const suffix = ` (${album})`;
  return t.endsWith(suffix) ? t.slice(0, -suffix.length).trim() : t;
}

function partNumber(title) {
  const m = PART.exec(title || '');
  return m ? Number(m[1]) : null;
}

function toEpisode(file, presenter) {
  const title = cleanTitle(file.title, file.album);
  return {
    id: `file-${file.id}`,
    title,
    description: '',
    playlist_media: { artist: presenter, album: (file.album || '').trim() },
    publish_at: file.uploaded_at || file.mtime || 0,
    links: { download: file.links && file.links.play, public: '', media: '' },
    is_published: true,
    art: file.art || '',
    episode_number: partNumber(title),
    length: Math.round(file.length || 0),
  };
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [v, n] of counts) if (n > bestCount) [best, bestCount] = [v, n];
  return best;
}

/** Pure: AzuraCast files → presenter documents, most sermons first. */
function buildPresenters(files) {
  const byArtist = new Map();
  for (const f of files) {
    const artist = (f.artist || '').trim();
    if (!PRESENTER.test(artist) || !(f.links && f.links.play)) continue;
    if (!byArtist.has(artist)) byArtist.set(artist, []);
    byArtist.get(artist).push(f);
  }

  const presenters = [];
  for (const [name, list] of byArtist) {
    const albums = new Map();
    for (const f of list) {
      const album = (f.album || '').trim();
      if (!albums.has(album)) albums.set(album, []);
      albums.get(album).push(f);
    }

    const series = [];
    const singles = [];
    for (const [album, albumFiles] of albums) {
      if (album && albumFiles.length >= 2) {
        const parts = albumFiles
          .map((f) => toEpisode(f, name))
          .sort((a, b) => (a.episode_number ?? Infinity) - (b.episode_number ?? Infinity)
            || a.publish_at - b.publish_at);
        series.push({
          id: slug(album),
          title: album,
          cover: albumFiles[0].art || '',
          parts,
        });
      } else {
        singles.push(...albumFiles.map((f) => toEpisode(f, name)));
      }
    }
    // Newest series first, like the singles.
    series.sort((a, b) => Math.max(...b.parts.map((p) => p.publish_at))
      - Math.max(...a.parts.map((p) => p.publish_at)));
    singles.sort((a, b) => b.publish_at - a.publish_at);

    const newest = [...list].sort((a, b) => (b.uploaded_at || 0) - (a.uploaded_at || 0))[0];
    presenters.push({
      id: slug(name),
      name,
      image: (newest && newest.art) || '',
      genre: mostCommon(list.map((f) => (f.genre || '').trim())),
      sermon_count: list.length,
      series_count: series.length,
      // Newest upload (seconds); the app rings presenters with new sermons.
      latest_at: Math.max(0, ...list.map((f) => f.uploaded_at || f.mtime || 0)),
      series,
      singles,
    });
  }
  return presenters.sort((a, b) => b.sermon_count - a.sermon_count || a.name.localeCompare(b.name));
}

/** The media library needs the API key. */
const fetchFiles = () => azuracastGet('/files', { auth: true });

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = await fetchFiles();
  const presenters = buildPresenters(files);
  console.log(`🎙️ ${presenters.length} presenters from ${files.length} files`);
  for (const p of presenters.slice(0, 10)) {
    console.log(`  ${p.sermon_count}\t${p.name} · ${p.genre} · ${p.series_count} series`);
  }
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }
  const { initializeFirebase } = require('./firebase');
  const firestore = initializeFirebase();
  const result = await syncDocs(firestore, firestore.collection(COLLECTION),
    Object.fromEntries(presenters.map((p) => [p.id, p])));
  console.log(`✅ Firestore: ${result.written} written, ${result.deleted} deleted`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Presenters sync failed:', err.message);
      process.exit(1);
    });
}

module.exports = { buildPresenters, cleanTitle, partNumber };
