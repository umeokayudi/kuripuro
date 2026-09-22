#!/usr/bin/env node
import {
  dateLocale,
  isDialogRoleDark,
  normalizeConfirmOptions,
  weekdayShortLabels,
} from '../src/lib/appDialog.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testDateLocale() {
  assert(dateLocale('ja') === 'ja-JP', 'ja locale')
  assert(dateLocale('pt') === 'pt-BR', 'pt locale')
  assert(dateLocale('en') === 'en-GB', 'en locale')
  assert(dateLocale(undefined) === 'en-GB', 'fallback locale')
}

function testRoleDark() {
  assert(isDialogRoleDark('employee') === true, 'employee dark')
  assert(isDialogRoleDark('client') === true, 'client dark')
  assert(isDialogRoleDark('admin') === false, 'admin light')
  assert(isDialogRoleDark(null) === false, 'no role light')
}

function testNormalize() {
  const fromString = normalizeConfirmOptions('Delete this?')
  assert(fromString.message === 'Delete this?', 'string becomes message')
  assert(fromString.tone === 'danger', 'default tone is danger')
  assert(fromString.confirmLabel === 'OK', 'default confirm')
  assert(fromString.cancelLabel === 'Cancel', 'default cancel')
  assert(fromString.title === '', 'empty title')

  const withDefaults = normalizeConfirmOptions('X', { title: 'Sure?', confirm: 'Yes', cancel: 'No' })
  assert(withDefaults.title === 'Sure?', 'default title')
  assert(withDefaults.confirmLabel === 'Yes', 'default confirm label')
  assert(withDefaults.cancelLabel === 'No', 'default cancel label')
  assert(withDefaults.message === 'X', 'keeps message')

  const obj = normalizeConfirmOptions({
    title: 'Remove store',
    message: 'Kodama?',
    confirmLabel: 'Delete',
    tone: 'primary',
  })
  assert(obj.title === 'Remove store', 'object title')
  assert(obj.message === 'Kodama?', 'object message')
  assert(obj.confirmLabel === 'Delete', 'object confirm')
  assert(obj.tone === 'primary', 'object tone')

  assert(normalizeConfirmOptions({ tone: 'warn' }).tone === 'gold', 'warn → gold')
  assert(normalizeConfirmOptions({ tone: 'warning' }).tone === 'gold', 'warning → gold')
  assert(normalizeConfirmOptions({ tone: 'delete' }).tone === 'danger', 'delete → danger')
  assert(normalizeConfirmOptions({ tone: 'nope' }).tone === 'danger', 'unknown tone → danger')
  assert(normalizeConfirmOptions(null).message === '', 'null is empty message')
  assert(normalizeConfirmOptions({ text: 'via text' }).message === 'via text', 'text alias')
  assert(normalizeConfirmOptions({ ok: 'Go', cancel: 'Stop' }).confirmLabel === 'Go', 'ok alias')
  assert(normalizeConfirmOptions({ hideCancel: true }).hideCancel === true, 'hideCancel')
  assert(normalizeConfirmOptions({ wide: 1 }).wide === true, 'wide')
}

function testWeekdays() {
  const pt = weekdayShortLabels('pt')
  assert(pt.length === 7, '7 weekdays')
  assert(/dom/i.test(pt[0]), `PT sunday got ${pt[0]}`)
  const ja = weekdayShortLabels('ja')
  assert(ja[0].includes('日') || ja[0].includes('Sun') === false, `JA sunday got ${ja[0]}`)
}

testDateLocale()
testRoleDark()
testNormalize()
testWeekdays()
console.log('app-dialog ok')
