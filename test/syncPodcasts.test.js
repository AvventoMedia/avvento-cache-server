const test = require('node:test');
const assert = require('node:assert');
const { toPodcastDoc, toEpisode, toPages, PAGE_SIZE } = require('../syncPodcasts');

const episode = (i) => ({
  id: `e${i}`, title: `Genesis ${i}`, description: 'd', publish_at: i, is_published: true,
  playlist_media: { artist: 'Faith Comes By Hearing', album: 'OT', extra: 'x' },
  links: { download: `dl-${i}`, public: `pub-${i}`, self: 'drop' },
  art: `art-${i}`, episode_number: i, season_number: 1, has_custom_art: true,
});

test('show documents keep the fields the app reads', () => {
  const doc = toPodcastDoc({
    id: 'p', title: 'OT', author: 'A', episodes: 3, art: 'art', art_updated_at: 9,
    categories: [{ category: 'Religion' }], is_published: true, branding_config: {},
  });
  assert.deepStrictEqual(Object.keys(doc).sort(), [
    'art_updated_at', 'author', 'categories', 'description', 'email', 'episodes',
    'id', 'is_published', 'links', 'title']);
  assert.strictEqual(doc.links.art, 'art');
});

test('episodes keep only what PodcastEpisode reads', () => {
  const e = toEpisode(episode(1));
  assert.deepStrictEqual(e.playlist_media, { artist: 'Faith Comes By Hearing', album: 'OT' });
  assert.deepStrictEqual(e.links, { download: 'dl-1', public: 'pub-1', media: '' });
  assert.strictEqual(e.has_custom_art, undefined);
  assert.strictEqual(e.season_number, 1);
});

test('pages are newest first and at most PAGE_SIZE long', () => {
  const pages = toPages(Array.from({ length: PAGE_SIZE + 5 }, (_, i) => episode(i + 1)));
  assert.deepStrictEqual(Object.keys(pages), ['0', '1']);
  assert.strictEqual(pages['0'].episodes.length, PAGE_SIZE);
  assert.strictEqual(pages['1'].episodes.length, 5);
  assert.strictEqual(pages['0'].episodes[0].id, `e${PAGE_SIZE + 5}`);
  assert.strictEqual(pages['1'].episodes.at(-1).id, 'e1');
  assert.deepStrictEqual(toPages([]), {});
});
