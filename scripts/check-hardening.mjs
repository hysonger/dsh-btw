import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const host = read('lib/index.js')
const client = read('lib/client.js')
assert.equal(pkg.private, true, 'The personal fork must never publish to the upstream npm namespace')
assert.equal(pkg.version, '1.3.11-hardened.1')
assert.equal(lock.version, pkg.version)
assert.equal(lock.packages[''].version, pkg.version)
assert.equal(pkg.engines.dsh, '0.2.2-rc.3')
assert.equal(pkg.dependencies['@deepseek-ai/schemastery'], '3.19.0')
assert.match(pkg.repository.url, /github\.com\/hysonger\/dsh-btw\.git$/)
for (const key of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(pkg.scripts[key], undefined)
for (const name of Object.keys(pkg.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-'))) assert.equal(pkg.peerDependencies[name], '0.2.2-rc.3')
assert.doesNotMatch(read('.github/workflows/publish.yml'), /npm publish|id-token: write|contents: write/)
assert.doesNotMatch(client, /require\(\s*["']@deepseek-ai\/dsh-client-/)
assert.doesNotMatch(client, /attachNativeAskButton|btw-native-ask-button/)
assert.match(client, /img: \(\) => null/)
assert.match(client, /skipHtml: true/)
assert.match(host, /BTW cannot send messages back/)
assert.doesNotMatch(host, /function isReplyToParent|function replyTargetOf|agent\.replyHint/)
for (const locale of ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
  const meta = JSON.parse(read(`locale/${locale}.json`)).meta
  assert.equal(meta.detail, 'HARDENING.md')
  assert.match(meta.title, /hardened|加固/)
}
assert.ok(pkg.files.includes('HARDENING.md'))
console.log('Hardened release checks passed: private/pinned manifest, no npm publishing, no private Client modules/global button injection, image/HTML-denying renderer and no parent-message exception.')
