import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'src', 'i18n', 'locales')

function flatten(obj, prefix = '') {
  const keys = []
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) keys.push(...flatten(v, key))
    else keys.push(key)
  }
  return keys
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
const base = 'en.json'
const baseKeys = new Set(flatten(JSON.parse(readFileSync(join(dir, base), 'utf8'))))

let failed = false
for (const f of files) {
  if (f === base) continue
  const keys = new Set(flatten(JSON.parse(readFileSync(join(dir, f), 'utf8'))))
  const missing = [...baseKeys].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !baseKeys.has(k))
  if (missing.length || extra.length) {
    failed = true
    console.error(`\n${f}:`)
    if (missing.length) console.error(`  missing: ${missing.join(', ')}`)
    if (extra.length) console.error(`  extra:   ${extra.join(', ')}`)
  }
}

if (failed) {
  console.error('\ni18n locale key parity check failed.')
  process.exit(1)
}
console.log(`i18n locales OK (${files.length} files, ${baseKeys.size} keys).`)
