#!/usr/bin/env node
// v1.0.115 · AI grade shown only with reasons
import { aiScoreView, aiReasonShort } from '../src/lib/aiScore.js'
const assert = (c, m) => { if (!c) throw new Error(m) }
assert(aiScoreView({ photo_ai_score: null }) === null, 'no score → hidden')
assert(aiScoreView({ photo_ai_score: 6, photo_ai_approved: false, photo_ai_issues: null }) === null, 'number without reason → hidden')
const ok = aiScoreView({ photo_ai_score: 9, photo_ai_approved: true, photo_ai_issues: null })
assert(ok && ok.clean && aiReasonShort(ok, 'sem problemas') === 'sem problemas', 'approved without issues → clean')
const bad = aiScoreView({ photo_ai_score: 5, photo_ai_approved: false, photo_ai_issues: 'piso molhado => secar; lixo => tirar' })
assert(bad && bad.reasons.length === 2 && aiReasonShort(bad, '') === 'piso molhado (+1)', 'reasons listed')
console.log('ai score: ok')
