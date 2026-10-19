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

const BASE_URL = (process.env.AZURACAST_BASE_URL || 'https://radio1.avventomedia.org').replace(/\/$/, '');
const STATION = process.env.AZURACAST_STATION || 'avventoradio';
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
      series,
      singles,
    });
  }
  return presenters.sort((a, b) => b.sermon_count - a.sermon_count || a.name.localeCompare(b.name));
}

async function fetchFiles() {
  const key = process.env.AZURACAST_APIKEY;
  if (!key) throw new Error('🚨 AZURACAST_APIKEY is missing');
  const res = await fetch(`${BASE_URL}/api/station/${STATION}/files`, {
    headers: { 'X-API-Key': key.trim() },
  });
  if (!res.ok) throw new Error(`AzuraCast files: HTTP ${res.status}`);
  return res.json();
}

/** Writes changed presenters and deletes ones that are gone. */
async function writePresenters(firestore, presenters) {
  const col = firestore.collection(COLLECTION);
  const existing = new Map((await col.get()).docs.map((d) => [d.id, d.data()]));
  let written = 0;
  let deleted = 0;
  const batch = firestore.batch();

  for (const p of presenters) {
    const old = existing.get(p.id);
    existing.delete(p.id);
    if (old && JSON.stringify({ ...old, updated_at: null }) === JSON.stringify({ ...p, updated_at: null })) continue;
    batch.set(col.doc(p.id), { ...p, updated_at: Date.now() });
    written++;
  }
  for (const id of existing.keys()) {
    batch.delete(col.doc(id));
    deleted++;
  }
  if (written || deleted) await batch.commit();
  return { written, deleted };
}

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
  const result = await writePresenters(initializeFirebase(), presenters);
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
