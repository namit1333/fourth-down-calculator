import './style.css'
import model from './model.json'

const $ = id => document.getElementById(id)
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const sigmoid = n => 1 / (1 + Math.exp(-clamp(n, -30, 30)))
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0)
const percent = n => `${(n * 100).toFixed(1)}%`
const position = n => n === 50 ? 'MIDFIELD' : n < 50 ? `OPP ${n}` : `OWN ${100 - n}`
const value = (id, min, max) => clamp(Number($(id).value) || 0, min, max)

function wp(score, seconds, yard, down, distance, ourTO, theirTO) {
  if (seconds <= 0) return score > 0 ? 1 : score < 0 ? 0 : .5
  const s = score / 10, t = clamp(seconds, 1, 3600) / 3600
  const urgency = 1 / Math.sqrt(Math.max(t, .015))
  const field = (50 - yard) / 50
  const to = (ourTO - theirTO) / 3
  return sigmoid(dot(model.wp, [1, s * urgency, s, field, field * urgency,
    Math.min(distance, 30) / 10, (down - 1) / 3, t, to, to * (1 - t)]))
}

function render() {
  const score = value('our-score', 0, 99) - value('their-score', 0, 99)
  const quarter = value('quarter', 1, 4)
  const minute = value('minutes', 0, 15)
  const second = value('seconds', 0, 59)
  const clock = minute * 60 + second
  const yard = value('yardline', 1, 99)
  const distance = value('distance', 1, 30)
  const ourTO = value('our-timeouts', 0, 3), theirTO = value('their-timeouts', 0, 3)
  const seconds = (4 - quarter) * 900 + clock
  const invalid = clock > 900 || clock === 0 || distance > yard
  $('validation').textContent = clock > 900 ? 'The quarter clock cannot exceed 15:00.' : clock === 0 ? 'Choose a time above 0:00; the quarter has ended.' : distance > yard ? 'Yards to go cannot exceed the distance to the goal line.' : ''
  $('yard-label').textContent = position(yard)
  $('distance-label').textContent = `${distance} ${distance === 1 ? 'YARD' : 'YARDS'}`
  $('field-label').textContent = position(yard)
  $('down-display').textContent = `4TH & ${distance === yard ? 'GOAL' : distance}`
  $('ball-marker').style.left = `${100 - yard}%`
  $('first-marker').style.left = `${Math.min(100, 100 - yard + distance)}%`
  for (const id of ['yardline', 'distance']) {
    const el = $(id); el.style.setProperty('--fill', `${(el.value - el.min) / (el.max - el.min) * 100}%`)
  }
  if (invalid) {
    for (const key of ['go', 'kick', 'punt']) {
      $(`${key}-wp`).textContent = '—'; $(`${key}-detail`).textContent = 'Adjust the game situation'; $(`${key}-bar`).style.width = '0%'
      document.querySelector(`[data-option="${key}"]`).classList.remove('best')
    }
    $('recommendation').textContent = 'Check the game situation'; $('rec-explanation').textContent = 'Enter a valid regulation situation to see the comparison.'
    return
  }
  const d = Math.min(distance, 30) / 10
  const conversion = sigmoid(dot(model.go, [1, d, d * d, yard < 10 ? 1 : 0]))
  const kickDistance = yard + 17
  const kd = kickDistance / 50
  const kickAvailable = kickDistance <= 75
  const kickProb = kickAvailable ? sigmoid(dot(model.kick, [1, kd, kd * kd])) : 0
  const after = Math.max(0, seconds - 7)
  const fail = 1 - wp(-score, after, 100 - yard, 1, 10, theirTO, ourTO)
  const gainedYard = Math.max(1, yard - distance - 2)
  const success = distance === yard
    ? 1 - wp(-(score + 7), after, 70, 1, 10, theirTO, ourTO)
    : wp(score, after, gainedYard, 1, Math.min(10, gainedYard), ourTO, theirTO)
  const go = conversion * success + (1 - conversion) * fail
  const make = 1 - wp(-(score + 3), after, 70, 1, 10, theirTO, ourTO)
  const missOppYard = Math.min(80, Math.max(1, 100 - (yard + 7)))
  const miss = 1 - wp(-score, after, missOppYard, 1, 10, theirTO, ourTO)
  const kick = kickProb * make + (1 - kickProb) * miss
  const opponentOwn = yard <= 40 ? 20 : Math.max(1, 100 - yard - 40)
  const punt = 1 - wp(-score, after, 100 - opponentOwn, 1, 10, theirTO, ourTO)
  const choices = [{key:'go', name:'Go for it', p:go}, ...(kickAvailable ? [{key:'kick', name:'Attempt kick', p:kick}] : []), {key:'punt', name:'Punt', p:punt}].sort((a,b) => b.p - a.p)
  const values = {go, kick, punt}
  for (const key of ['go', 'kick', 'punt']) {
    const available = key !== 'kick' || kickAvailable
    $(`${key}-wp`).textContent = available ? percent(values[key]) : 'N/A'
    $(`${key}-bar`).style.width = available ? `${clamp(values[key] * 100, 0, 100)}%` : '0%'
    document.querySelector(`[data-option="${key}"]`).classList.toggle('best', choices[0].key === key)
  }
  $('go-detail').textContent = `${percent(conversion)} chance to convert`
  $('kick-detail').textContent = kickAvailable ? `${kickDistance}-yard attempt · ${percent(kickProb)} make` : `${kickDistance}-yard attempt · outside model range`
  $('punt-detail').textContent = `Estimated landing: opponent ${opponentOwn}`
  $('recommendation').textContent = choices[0].name + '.'
  const edge = (choices[0].p - choices[1].p) * 100
  $('rec-explanation').textContent = edge < .05 ? 'The top choices are effectively tied in this approximation.' : `About ${edge.toFixed(1)} percentage points above ${choices[1].name.toLowerCase()}, the next-best option.`
}

document.querySelectorAll('input, select').forEach(el => el.addEventListener('input', render))
render()
