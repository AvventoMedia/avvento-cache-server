const test = require('node:test');
const assert = require('node:assert');
const { buildPresenters, cleanTitle, partNumber } = require('../syncPresenters');

const file = (id, artist, title, album, uploaded, genre = 'Prophecy') => ({
  id, artist, title, album, genre, uploaded_at: uploaded, length: 60, art: `art-${id}`,
  links: { play: `play-${id}` },
});

test('titles drop the repeated album and parts are numbered', () => {
  assert.strictEqual(
    cleanTitle('Pt. 1 - Busy Here and There (Busy Here and There)', 'Busy Here and There'),
    'Pt. 1 - Busy Here and There');
  assert.strictEqual(cleanTitle('Grace (Other)', 'Album'), 'Grace (Other)');
  assert.strictEqual(partNumber('Pt. 12 - Title'), 12);
  assert.strictEqual(partNumber('Part 3'), 3);
  assert.strictEqual(partNumber('Grace That Is Greater'), null);
});

test('groups presenters, series in part order and singles newest first', () => {
  const presenters = buildPresenters([
    file(1, 'Pr. Okello Samuel', 'Pt. 2 - B (Series)', 'Series', 20),
    file(2, 'Pr. Okello Samuel', 'Pt. 1 - A (Series)', 'Series', 30),
    file(3, 'Pr. Okello Samuel', 'Single old', '', 10, 'Christian Living'),
    file(4, 'Pr. Okello Samuel', 'Single new', 'One-off album', 40),
    file(5, 'Ev. Denis Mukaisa', 'Devotion 1', '', 5),
    file(6, 'Faith Comes By Hearing', 'Genesis 1', 'Bible', 1),
    { ...file(7, 'Pr. Okello Samuel', 'No audio', '', 50), links: {} },
  ]);

  // Ministries and files without audio are skipped; most sermons first.
  assert.deepStrictEqual(presenters.map((p) => p.name), ['Pr. Okello Samuel', 'Ev. Denis Mukaisa']);
  const okello = presenters[0];
  assert.strictEqual(okello.id, 'pr-okello-samuel');
  assert.strictEqual(okello.sermon_count, 4);
  assert.strictEqual(okello.series_count, 1);
  assert.strictEqual(okello.genre, 'Prophecy');
  assert.strictEqual(okello.image, 'art-4'); // Newest file's art.
  assert.strictEqual(okello.latest_at, 40);

  const series = okello.series[0];
  assert.strictEqual(series.title, 'Series');
  assert.deepStrictEqual(series.parts.map((p) => p.title), ['Pt. 1 - A', 'Pt. 2 - B']);
  assert.deepStrictEqual(series.parts.map((p) => p.episode_number), [1, 2]);
  assert.deepStrictEqual(okello.singles.map((p) => p.title), ['Single new', 'Single old']);

  // Episodes match the podcast-episode shape the app parses.
  const ep = series.parts[0];
  assert.strictEqual(ep.id, 'file-2');
  assert.strictEqual(ep.links.download, 'play-2');
  assert.strictEqual(ep.playlist_media.artist, 'Pr. Okello Samuel');
  assert.strictEqual(ep.publish_at, 30);
});
