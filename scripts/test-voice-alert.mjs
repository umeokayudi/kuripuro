import { pickAlertVoice } from '../src/lib/voiceAlert.js'

function assert(c, m) { if (!c) { console.error('❌', m); process.exit(1) } }
const v = (name, lang) => ({ name, lang, voiceURI: name })

// iPhone: the first ja/en voices in the list are male or joke voices
const ios = [v('Albert', 'en-US'), v('Bad News', 'en-US'), v('Fred', 'en-US'), v('Samantha', 'en-US'), v('Daniel', 'en-GB'),
  v('Hattori', 'ja-JP'), v('Kyoko', 'ja-JP'), v('O-ren', 'ja-JP'), v('Felipe', 'pt-BR'), v('Luciana', 'pt-BR'), v('Joana', 'pt-PT')]
assert(pickAlertVoice(ios, 'en').name === 'Samantha', 'en → Samantha')
assert(pickAlertVoice(ios, 'ja').name === 'Kyoko', 'ja → Kyoko')
assert(pickAlertVoice(ios, 'pt').name === 'Luciana', 'pt → Luciana (Brazil)')

// Chrome desktop
const chrome = [v('Google UK English Male', 'en-GB'), v('Google US English', 'en-US'), v('Google 日本語', 'ja-JP'), v('Google português do Brasil', 'pt-BR')]
assert(pickAlertVoice(chrome, 'en').name === 'Google US English', 'chrome en')
assert(pickAlertVoice(chrome, 'ja').name === 'Google 日本語', 'chrome ja')
assert(pickAlertVoice(chrome, 'pt').name === 'Google português do Brasil', 'chrome pt')

// Windows
const win = [v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US'),
  v('Microsoft Ichiro - Japanese (Japan)', 'ja-JP'), v('Microsoft Haruka - Japanese (Japan)', 'ja-JP'), v('Microsoft Daniel - Portuguese (Brazil)', 'pt-BR'), v('Microsoft Maria - Portuguese (Brazil)', 'pt-BR')]
assert(pickAlertVoice(win, 'en').name.includes('Zira'), 'win en')
assert(pickAlertVoice(win, 'ja').name.includes('Haruka'), 'win ja')
assert(pickAlertVoice(win, 'pt').name.includes('Maria'), 'win pt')

// Android uses ja_JP style codes; only male left → still that language; only joke voices → none
assert(pickAlertVoice([v('ja-jp-x-htm-local', 'ja_JP')], 'ja'), 'android underscore lang')
assert(pickAlertVoice([v('Otoya', 'ja-JP')], 'ja').name === 'Otoya', 'male only as last resort')
assert(pickAlertVoice([v('Zarvox', 'en-US'), v('Kyoko', 'ja-JP')], 'en') === null, 'never a joke voice nor another language')
assert(pickAlertVoice([], 'pt') === null, 'empty list')

console.log('✅ voice alert: right language, female voice')
