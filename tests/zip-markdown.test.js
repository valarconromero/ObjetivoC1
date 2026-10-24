import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, createZip, readZip } from '../js/zip.js';
import { renderMarkdown } from '../js/markdown.js';

test('crc32 matches the reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round trip keeps text and binary entries', async () => {
  const audio = new Uint8Array([0, 1, 2, 250, 255]);
  const zip = await createZip([
    { name: 'datos.json', data: '{"a":1}' },
    { name: 'materiales/semana-01/año.md', data: '# Título\n' },
    { name: 'materiales/semana-01/a.webm', data: audio },
  ]);
  const files = await readZip(zip);
  assert.deepEqual([...files.keys()], ['datos.json', 'materiales/semana-01/año.md', 'materiales/semana-01/a.webm']);
  assert.equal(new TextDecoder().decode(await files.get('datos.json')()), '{"a":1}');
  assert.deepEqual([...(await files.get('materiales/semana-01/a.webm')())], [...audio]);
});

test('zip files open with the system unzip tool', async (t) => {
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { return t.skip('unzip not installed'); }
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const zip = await createZip([{ name: 'carpeta/hola.txt', data: 'hola' }]);
  writeFileSync(join(dir, 'a.zip'), Buffer.from(await zip.arrayBuffer()));
  execFileSync('unzip', ['-q', join(dir, 'a.zip'), '-d', join(dir, 'out')]);
  assert.equal(readFileSync(join(dir, 'out/carpeta/hola.txt'), 'utf8'), 'hola');
});

test('readZip handles deflate-compressed archives (re-zipped by the OS)', async (t) => {
  try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); } catch { return t.skip('zip not installed'); }
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  writeFileSync(join(dir, 'datos.json'), JSON.stringify({ text: 'x'.repeat(2000) }));
  execFileSync('zip', ['-q', '-9', 'out.zip', 'datos.json'], { cwd: dir });
  const files = await readZip(new Blob([readFileSync(join(dir, 'out.zip'))]));
  assert.equal(JSON.parse(new TextDecoder().decode(await files.get('datos.json')())).text.length, 2000);
});

test('markdown renders basic blocks and escapes HTML', () => {
  const html = renderMarkdown('# Title\n\nSome **bold** and *it*.\n\n- one\n- two\n\n<script>x</script>');
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<strong>bold<\/strong> and <em>it<\/em>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('markdown only links http(s) URLs', () => {
  assert.match(renderMarkdown('[ok](https://bbc.co.uk)'), /<a href="https:\/\/bbc.co.uk"/);
  assert.doesNotMatch(renderMarkdown('[bad](javascript:alert(1))'), /<a /);
});
