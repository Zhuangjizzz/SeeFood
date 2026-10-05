const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('native conditional directives bind expressions rather than truthy string literals', () => {
  const root = path.join(__dirname, '..', 'miniprogram');
  const templates = fs.readdirSync(root, { recursive: true }).filter((file) => file.endsWith('.wxml'));
  const unbound = [];
  for (const file of templates) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/wx:(?:if|elif)\s*=\s*(["'])(.*?)\1/g)) {
      if (!/^\{\{[\s\S]+\}\}$/.test(match[2].trim())) {
        const line = content.slice(0, match.index).split('\n').length;
        unbound.push(`${file}:${line}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(unbound, [], 'WXML conditions must use {{expression}}; bare values are strings');
});
