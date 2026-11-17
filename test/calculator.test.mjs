import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const model = JSON.parse(await readFile('src/model.json', 'utf8'))
const source = (await readFile('src/calculator.js', 'utf8'))
  .replace("import model from './model.json'", `const model = ${JSON.stringify(model)}`)
const { calculate, puntSpot, wp } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const main = (await readFile('src/main.js', 'utf8'))
  .replace("import './style.css'", '')
  .replace("import { calculate } from './calculator.js'", '')

function page() {
  const elements = {}
  const define = (id, value = '', min = '', max = '', step = '1') => {
    const el = { id, value: String(value), min, max, step, textContent: '', attrs: {},
      style: { setProperty(key, value) { this[key] = value } },
      setAttribute(k, v) { this.attrs[k] = v }, removeAttribute(k) { delete this.attrs[k] },
      addEventListener(_, fn) { this.handler = fn },
      get valueAsNumber() { return this.value === '' ? NaN : Number(this.value) },
      get validity() { const n = this.valueAsNumber; return { valid: Number.isFinite(n) && n >= +this.min && n <= +this.max && Number.isInteger((n - +this.min) / +this.step) } } }
    elements[id] = el; return el
  }
  define('our-score', 21, '0', '9999'); define('their-score', 24, '0', '9999')
  define('minutes', 8, '0', '15'); define('seconds', 30, '0', '59')
  define('yardline', 62, '.5', '99.5', '.5'); define('distance', 3, '.5', '99.5', '.5')
  for (const [id, value] of [['quarter',4],['our-timeouts',3],['their-timeouts',3]]) define(id, value)
  for (const id of ['validation','scenario-warning','yard-label','distance-label','field-label','down-display','ball-marker','first-marker','go-wp','kick-wp','punt-wp','go-bar','kick-bar','punt-bar','go-detail','kick-detail','punt-detail','recommendation','rec-explanation']) define(id)
  const cards = Object.fromEntries(['go','kick','punt'].map(k => [k, { classList: { toggle() {}, remove() {} } }]))
  const doc = {getElementById: id => elements[id], querySelector: s => cards[s.match(/"(go|kick|punt)"/)[1]],
    querySelectorAll: () => Object.values(elements).filter(e => ['our-score','their-score','minutes','seconds','yardline','distance','quarter','our-timeouts','their-timeouts'].includes(e.id))}
  vm.runInNewContext(main, {document: doc, calculate, Number, Math, Error})
  return elements
}

test('field slider runs from own goal to opponent goal and matches marker', () => {
  const e = page()
  e.yardline.value = '.5'; e.yardline.handler(); assert.equal(e['yard-label'].textContent, 'OWN ½'); assert.equal(e['ball-marker'].style.left, '0.5%')
  e.yardline.value = '50'; e.yardline.handler(); assert.equal(e['yard-label'].textContent, 'MIDFIELD')
  e.yardline.value = '99.5'; e.distance.value = '.5'; e.yardline.handler(); assert.equal(e['yard-label'].textContent, 'OPP ½'); assert.equal(e['down-display'].textContent, '4TH & GOAL')
})

test('rejects blank, out-of-range, fractional, invalid clock and distance entries', () => {
  const e = page()
  for (const [id, value] of [['our-score',''],['our-score','10000'],['our-score','1.5'],['minutes','16'],['seconds','60']]) {
    const old = e[id].value; e[id].value = value; e[id].handler()
    assert.notEqual(e.validation.textContent, ''); assert.equal(e['go-wp'].textContent, '—'); assert.equal(e[id].value, value)
    e[id].value = old; e[id].handler(); assert.equal(e.validation.textContent, '')
  }
  e.minutes.value = '15'; e.seconds.value = '1'; e.seconds.handler(); assert.match(e.validation.textContent, /15:00/)
  e.minutes.value = '0'; e.seconds.value = '0'; e.seconds.handler(); assert.match(e.validation.textContent, /quarter has ended/)
  e.minutes.value = '8'; e.seconds.value = '30'; e.distance.value = '40'; e.distance.handler(); assert.match(e.validation.textContent, /goal line/)
  e.distance.value = '35'; e.yardline.value = '1'; e.yardline.handler(); assert.equal(e.validation.textContent, ''); assert.match(e['scenario-warning'].textContent, /rare/)
})

test('punt outcomes and touchdown branches remain finite and bounded in varied situations', () => {
  for (const yard of [.5, 1, 20, 38, 50, 75, 99.5]) {
    const r = calculate({score: 0, quarter: 4, clock: 600, yard, distance: Math.min(yard, 3), ourTO: 3, theirTO: 3})
    for (const p of [r.go, r.conversion, r.tdProb, ...(r.punt === null ? [] : [r.punt]), ...(r.kick === null ? [] : [r.kick])]) assert.ok(Number.isFinite(p) && p >= 0 && p <= 1)
    if (yard === 75) assert.ok(r.puntAverageOwn > 15 && r.puntAverageOwn < 50)
    if (yard === .5) assert.equal(r.tdProb, 1)
  }
  const long = calculate({score: 0, quarter: 4, clock: 600, yard: 80, distance: 50, ourTO: 3, theirTO: 3})
  assert.ok(long.tdProb < .2, `long conversion touchdown rate unexpectedly high: ${long.tdProb}`)
})

test('sparse near-goal punts are unavailable and excluded from the recommendation', () => {
  for (const yard of [.5, 1, 10, 20, 30]) {
    const r = calculate({score: 0, quarter: 4, clock: 600, yard, distance: Math.min(yard, 1), ourTO: 3, theirTO: 3})
    assert.equal(r.punt, null)
    assert.equal(r.puntAverageOwn, null)
  }
  for (const yard of [30.5, 31, 40, 40.5, 50, 99.5]) {
    const r = calculate({score: 0, quarter: 4, clock: 600, yard, distance: 1, ourTO: 3, theirTO: 3})
    assert.ok(Number.isFinite(r.punt) && r.punt >= 0 && r.punt <= 1)
  }
  const e = page()
  e.yardline.value = '99'; e.distance.value = '1'; e.yardline.handler()
  assert.equal(e['punt-wp'].textContent, 'N/A')
  assert.match(e['punt-detail'].textContent, /Insufficient/)
  assert.match(e['recommendation'].textContent, /modeled options only/)
  assert.match(e['rec-explanation'].textContent, /Punt is not included/)
})

test('net distances crossing the goal line use touchback, not an invented half-yard spot', async () => {
  assert.equal(puntSpot(31, 35), 20)
  assert.equal(puntSpot(35, 35), 20)
  assert.equal(puntSpot(35.5, 35), .5)
  assert.equal(puntSpot(40, 30), 10)
  assert.equal(puntSpot(99, -10), 99.5)
  const synthetic = {...model, punts: model.punts.map(() => [['35', 1]])}
  const code = (await readFile('src/calculator.js', 'utf8'))
    .replace("import model from './model.json'", `const model = ${JSON.stringify(synthetic)}`)
  const {calculate: calc} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const result = calc({score: 0, quarter: 4, clock: 60, yard: 31, distance: 1, ourTO: 3, theirTO: 2})
  assert.equal(result.puntAverageOwn, 20)
  assert.equal(result.punt, 1 - wp(0, 53, 80, 1, 10, 2, 3))
})

test('a punt return touchdown gives possession back to the offense', async () => {
  const synthetic = {...model, punts: model.punts.map(() => [['return_td', 1]])}
  const code = (await readFile('src/calculator.js', 'utf8'))
    .replace("import model from './model.json'", `const model = ${JSON.stringify(synthetic)}`)
  const {calculate: calc, wp} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const situation = {score: 0, quarter: 4, clock: 60, yard: 70, distance: 5, ourTO: 3, theirTO: 2}
  assert.equal(calc(situation).punt, wp(-7, 53, 70, 1, 10, 3, 2))
})
