import './style.css'
import { calculate } from './calculator.js'

const $ = id => document.getElementById(id)
const percent = n => `${(n * 100).toFixed(1)}%`
const yards = n => Number.isInteger(n) ? String(n) : `${Math.floor(n) || ''}½`
const position = n => n === 50 ? 'MIDFIELD' : n < 50 ? `OPP ${yards(n)}` : `OWN ${yards(100 - n)}`

function reset(message) {
  for (const key of ['go', 'kick', 'punt']) {
    $(`${key}-wp`).textContent = '—'
    $(`${key}-detail`).textContent = 'Adjust the game situation'
    $(`${key}-bar`).style.width = '0%'
    document.querySelector(`[data-option="${key}"]`).classList.remove('best')
  }
  $('recommendation').textContent = 'Check the game situation'
  $('rec-explanation').textContent = message
}

function readNumber(id, label) {
  const input = $(id)
  if (input.value === '' || !input.validity.valid || !Number.isFinite(input.valueAsNumber)) {
    input.setAttribute('aria-invalid', 'true')
    throw new Error(`${label}: enter a whole number from ${input.min} to ${input.max}.`)
  }
  input.removeAttribute('aria-invalid')
  return input.valueAsNumber
}

function render() {
  const sliderPosition = Number($('yardline').value)
  const yard = 100 - sliderPosition
  const distance = Number($('distance').value)
  $('yard-label').textContent = position(yard)
  $('distance-label').textContent = `${yards(distance)} ${distance === 1 ? 'YARD' : 'YARDS'}`
  $('field-label').textContent = position(yard)
  $('down-display').textContent = `4TH & ${distance === yard ? 'GOAL' : yards(distance)}`
  $('ball-marker').style.left = `${sliderPosition}%`
  $('first-marker').style.left = `${Math.min(100, sliderPosition + distance)}%`
  for (const id of ['yardline', 'distance']) {
    const el = $(id); el.style.setProperty('--fill', `${(el.value - el.min) / (el.max - el.min) * 100}%`)
    el.setAttribute('aria-valuetext', id === 'yardline' ? position(yard) : `${yards(distance)} yards`)
  }
  let ourScore, theirScore, minute, second
  try {
    ourScore = readNumber('our-score', 'Your score')
    theirScore = readNumber('their-score', 'Opponent score')
    minute = readNumber('minutes', 'Minutes')
    second = readNumber('seconds', 'Seconds')
    const clock = minute * 60 + second
    if (clock > 900) throw new Error('The quarter clock cannot exceed 15:00.')
    if (clock === 0) throw new Error('The quarter has ended. Select the next quarter and 15:00.')
    if (distance > yard) throw new Error('Yards to go cannot exceed the distance to the goal line.')
    $('validation').textContent = ''
    const warnings = []
    if (distance > 30) warnings.push('Long-distance situations are rare; estimates extrapolate beyond most historical attempts.')
    if (Number($('quarter').value) === 2 && clock <= 7) warnings.push('A play ending the first half is approximate: second-half kickoff possession is not modeled.')
    $('scenario-warning').textContent = warnings.join(' ')
    const result = calculate({score: ourScore - theirScore, quarter: Number($('quarter').value),
      clock, yard, distance, ourTO: Number($('our-timeouts').value), theirTO: Number($('their-timeouts').value)})
    const choices = [{key:'go', name:'Go for it', p:result.go},
      ...(result.kick === null ? [] : [{key:'kick', name:'Attempt kick', p:result.kick}]),
      ...(result.punt === null ? [] : [{key:'punt', name:'Punt', p:result.punt}])].sort((a, b) => b.p - a.p)
    for (const key of ['go', 'kick', 'punt']) {
      const p = result[key]
      $(`${key}-wp`).textContent = p === null ? 'N/A' : percent(p)
      $(`${key}-bar`).style.width = p === null ? '0%' : `${p * 100}%`
      document.querySelector(`[data-option="${key}"]`).classList.toggle('best', result.punt !== null && choices[0].key === key)
    }
    $('go-detail').textContent = `${percent(result.conversion)} chance to convert`
    $('kick-detail').textContent = result.kick === null ? `${yards(result.kickDistance)}-yard attempt · outside model range` : `${yards(result.kickDistance)}-yard attempt · ${percent(result.kickProb)} make`
    $('punt-detail').textContent = result.punt === null ? 'Insufficient punt data at this field position' : 'Historical punt outcomes by field position'
    $('recommendation').textContent = result.punt === null ? `${choices[0].name} (modeled options only).` : choices[0].name + '.'
    const edge = (choices[0].p - choices[1].p) * 100
    const comparison = edge < .05 ? 'The modeled choices are effectively tied in this approximation.' : `About ${edge.toFixed(1)} percentage points above ${choices[1].name.toLowerCase()}, the next-best modeled option.`
    $('rec-explanation').textContent = result.punt === null ? `${comparison} Punt is not included: insufficient data.` : comparison
  } catch (error) {
    $('validation').textContent = error.message
    $('scenario-warning').textContent = ''
    reset('Enter a valid regulation situation to see the comparison.')
  }
}

document.querySelectorAll('input, select').forEach(el => el.addEventListener('input', render))
render()
