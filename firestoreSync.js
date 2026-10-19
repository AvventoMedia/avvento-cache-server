/**
 * Makes a Firestore collection match [docs] ({id: data}): writes only
 * documents whose data changed and deletes the rest. Returns counts.
 */
async function syncDocs(firestore, collectionRef, docs) {
  const existing = new Map((await collectionRef.get()).docs.map((d) => [d.id, d.data()]));
  const same = (a, b) =>
    JSON.stringify({ ...a, updated_at: null }) === JSON.stringify({ ...b, updated_at: null });

  const writes = [];
  for (const [id, data] of Object.entries(docs)) {
    const old = existing.get(id);
    existing.delete(id);
    if (old && same(old, data)) continue;
    writes.push((batch) => batch.set(collectionRef.doc(id), { ...data, updated_at: Date.now() }));
  }
  const deletes = [...existing.keys()].map((id) => (batch) => batch.delete(collectionRef.doc(id)));

  // Firestore batches take up to 500 operations.
  const ops = [...writes, ...deletes];
  for (let i = 0; i < ops.length; i += 450) {
    const batch = firestore.batch();
    ops.slice(i, i + 450).forEach((op) => op(batch));
    await batch.commit();
  }
  return { written: writes.length, deleted: deletes.length };
}

module.exports = { syncDocs };
