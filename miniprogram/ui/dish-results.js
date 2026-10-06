/** Overlay delivered, unsaved cards for reading without mutating the saved record/chat scope. */
function readCards(record, jobState) {
  let cards = (record.cards || []).slice();
  for (const job of jobState.unsavedJobs || []) {
    if (job.kind !== 'image_cards' || job.state !== 'succeeded') continue;
    const image = record.images.find((item) => item.id === job.target.imageId);
    const previous = image && image.stageJobs.image_cards;
    const oldIds = new Set(previous && previous.output ? previous.output.cards.map((card) => card.id) : []);
    const newIds = new Set(job.output.cards.map((card) => card.id));
    cards = cards.filter((card) => !oldIds.has(card.id) && !newIds.has(card.id)).concat(job.output.cards);
  }
  return cards;
}
module.exports = { readCards };
