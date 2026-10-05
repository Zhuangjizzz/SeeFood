let sequence = 0;

function makeId(kind) {
  return `${kind}-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2, 12)}`;
}

module.exports = { makeId };
