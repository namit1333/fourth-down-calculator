import model from './model.json'

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const sigmoid = n => 1 / (1 + Math.exp(-clamp(n, -30, 30)))
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0)

export function wp(score, seconds, yard, down, distance, ourTO, theirTO) {
  if (seconds <= 0) return score > 0 ? 1 : score < 0 ? 0 : .5
  const s = score / 10, t = Math.min(seconds, 3600) / 3600
  const urgency = 1 / Math.sqrt(Math.max(t, .015))
  const field = (50 - yard) / 50
  const to = (ourTO - theirTO) / 3
  return sigmoid(dot(model.wp, [1, s * urgency, s, field, field * urgency,
    Math.min(distance, 30) / 10, (down - 1) / 3, t, to, to * (1 - t)]))
}

export function calculate({score, quarter, clock, yard, distance, ourTO, theirTO}) {
  const seconds = (4 - quarter) * 900 + clock
  const after = Math.max(0, seconds - 7)
  const d = Math.min(distance, 50) / 10
  const conversion = sigmoid(dot(model.go, [1, d, d * d, yard < 10 ? 1 : 0]))
  const kickDistance = yard + 17
  const kickAvailable = kickDistance <= 75
  const kd = kickDistance / 50
  const kickProb = kickAvailable ? sigmoid(dot(model.kick, [1, kd, kd * kd])) : null
  const opponent = (opponentScore, opponentYard) => 1 - wp(-opponentScore, after, opponentYard, 1, Math.min(10, opponentYard), theirTO, ourTO)
  const fail = opponent(score, 100 - yard)
  const gainedYard = Math.max(.5, yard - distance - model.extra_gain)
  const firstDown = wp(score, after, gainedYard, 1, Math.min(10, gainedYard), ourTO, theirTO)
  // Goal-to-go conversions are assumed to be touchdowns; otherwise estimate
  // the probability that a conversion scores, conditioned on a conversion.
  const x = Math.min(yard, 50) / 20
  const remaining = clamp((yard - distance) / 20, 0, 2.5)
  const tdProb = distance === yard ? 1 : sigmoid(dot(model.td, [1, remaining, x]))
  const touchdown = opponent(score + 7, 70)
  const go = conversion * (tdProb * touchdown + (1 - tdProb) * firstDown) + (1 - conversion) * fail
  const make = opponent(score + 3, 70)
  const missOppYard = Math.min(80, Math.max(.5, 100 - (yard + 7)))
  const kick = kickAvailable ? kickProb * make + (1 - kickProb) * opponent(score, missOppYard) : null
  const bucket = Math.min(9, Math.floor((yard - .5) / 10))
  const outcomes = model.punts[bucket]
  let punt = 0, ownSum = 0, ownCount = 0, total = 0
  for (const [outcome, count] of outcomes) {
    let own
    if (outcome === 'return_td') {
      // A return touchdown is followed by a kickoff to the original offense.
      punt += count * wp(score - 7, after, 70, 1, 10, ourTO, theirTO)
    } else {
      own = outcome === 'touchback' ? 20 : outcome === 'block' ? 100 - yard : clamp(yard - Number(outcome), .5, 99.5)
      punt += count * opponent(score, 100 - own)
      ownSum += count * own
      ownCount += count
    }
    total += count
  }
  return {go, kick, punt: punt / total, conversion, kickProb, kickDistance,
    tdProb, puntAverageOwn: ownSum / ownCount}
}
