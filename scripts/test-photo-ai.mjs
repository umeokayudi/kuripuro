#!/usr/bin/env node
/**
 * Photo AI: multi-photo packing, objective scoring, deep-clean minimums.
 * No production writes. No live Gemini calls.
 */
import {
  PHOTO_AI_APPROVE_MIN,
  PHOTO_AI_MAX_ANALYZE,
  PHOTO_UPLOAD_MAX,
  isCoverageComplaint,
  minAfterPhotosForJob,
  minAfterPhotosForType,
  buildPhotoAiPrompt,
  parsePhotoAiJson,
  normalizePhotoAiResult,
  formatPhotoAiIssues,
  sanitizeStoredPhotoIssues,
  photoUrlsForAnalyze,
  buildEvaluateReportPrompt,
  normalizeEvaluateResult,
} from '../src/lib/photoAi.js'
import { parsePhotoUrls, packPhotoUrls, primaryPhotoUrl, photoUrlCount } from '../src/lib/jobPhotoUrls.js'
import { ALL_DEEP_COMPONENT_IDS } from '../src/lib/cleaningType.js'
import { viewablePhotoUrl, isStoragePhotoUrl } from '../src/lib/photoUrl.js'
import { kuripuroEn, kuripuroJa, fill } from '../src/i18n/kuripuro.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testPackParse() {
  assert(parsePhotoUrls(null).length === 0, 'null → []')
  assert(parsePhotoUrls('').length === 0, 'empty → []')
  assert(parsePhotoUrls('jobs/a/end_0.jpg').join() === 'jobs/a/end_0.jpg', 'single path')
  const packed = packPhotoUrls(['jobs/a/end_0.jpg', 'jobs/a/end_1.jpg', 'jobs/a/end_2.jpg'])
  assert(packed.startsWith('['), `multi packs as JSON: ${packed}`)
  const round = parsePhotoUrls(packed)
  assert(round.length === 3 && round[1] === 'jobs/a/end_1.jpg', `roundtrip ${round}`)
  assert(packPhotoUrls(['only.jpg']) === 'only.jpg', 'single stays a plain string')
  assert(parsePhotoUrls('a.jpg||b.jpg').length === 2, '|| split')
  assert(parsePhotoUrls('a.jpg\nb.jpg').length === 2, 'newline split')
  assert(parsePhotoUrls([' x ', '', 'y']).join('|') === 'x|y', 'array trims')
  assert(primaryPhotoUrl(packed) === 'jobs/a/end_0.jpg', 'primary of packed')
  assert(photoUrlCount(packed) === 3, 'count packed')
  assert(photoUrlsForAnalyze(Array.from({ length: 10 }, (_, i) => `p${i}.jpg`)).length === PHOTO_AI_MAX_ANALYZE, 'analyze cap')
  assert(PHOTO_UPLOAD_MAX === 8, 'upload max 8')
  const storagePacked = packPhotoUrls(['jobs/uuid/end_0.jpg', 'jobs/uuid/end_1.jpg'])
  assert(isStoragePhotoUrl(storagePacked), 'packed JSON still detected as storage')
  assert(viewablePhotoUrl(storagePacked).includes('end_0.jpg'), 'viewable unwraps primary')
}

function testMinPhotos() {
  assert(minAfterPhotosForType('basic') === 1, 'basic needs 1')
  assert(minAfterPhotosForType('deep', 5) === 4, 'full deep needs 4')
  assert(minAfterPhotosForType('deep', ALL_DEEP_COMPONENT_IDS.length) === 4, '5 components → 4')
  assert(minAfterPhotosForType('deep', 2) === 3, 'partial deep needs 3')
  assert(minAfterPhotosForType('deep', 0) === 4, 'unknown deep defaults to 4')
  assert(minAfterPhotosForJob({ title: 'Kodama Shinbashi — Basic Cleaning' }) === 1, 'basic job')
  assert(minAfterPhotosForJob({ title: 'Ibushio — Deep Clean' }) === 4, 'full deep job')
  assert(minAfterPhotosForJob({ title: 'Ibushio — Deep Clean (Grease Trap)' }) === 3, 'one-component deep')
}

function testCoverageComplaints() {
  const complaints = [
    'Uma foto não mostra o restaurante inteiro',
    'Não dá para ver o grease trap',
    'Faltam áreas do checklist',
    'Foto única não prova o checklist completo',
    'Cannot see everything in one photo',
    'Does not cover the whole shop',
    '1枚では全体が見えない',
    '写真だけではチェックリスト全部を証明できない',
    'Não aparece o range hood',
    'Missing rooms from the photo',
  ]
  for (const text of complaints) {
    assert(isCoverageComplaint(text), `coverage: ${text}`)
  }
  const dirt = ['Lixo no chão perto da pia', 'Gordura visível no piso', 'Restos de comida na bancada']
  for (const text of dirt) {
    assert(!isCoverageComplaint(text), `dirt kept: ${text}`)
  }

  const stripped = normalizePhotoAiResult({
    nota: 4,
    aprovado: false,
    problemas: ['Uma foto não mostra tudo', 'Faltam áreas', 'Lixo no chão'],
    cobertura: 'Só o corredor',
    resumo: 'Não prova o checklist',
  }, { photoCount: 1 })
  assert(stripped.problemas.join() === 'Lixo no chão', `kept dirt only: ${stripped.problemas}`)
  assert(stripped.nota === 4, `dirt keeps low score: ${stripped.nota}`)
  assert(stripped.aprovado === false, 'dirt not auto-approved')
  assert(stripped.fotos === 1, 'photo count')

  const coverageOnly = normalizePhotoAiResult({
    nota: 3,
    aprovado: false,
    problemas: ['Não mostra o estabelecimento inteiro', 'Missing areas'],
  }, { photoCount: 1 })
  assert(coverageOnly.problemas.length === 0, 'coverage-only problemas empty')
  assert(coverageOnly.nota === PHOTO_AI_APPROVE_MIN, `bumped to ${PHOTO_AI_APPROVE_MIN}: ${coverageOnly.nota}`)
  assert(coverageOnly.aprovado === true, 'coverage-only approved')

  const clean = normalizePhotoAiResult({ nota: 8, problemas: [] }, { photoCount: 4 })
  assert(clean.aprovado === true && clean.nota === 8, 'clean 8/10')
  assert(formatPhotoAiIssues(coverageOnly) === null, 'no issues string when only coverage')
  assert(formatPhotoAiIssues(stripped) === 'Lixo no chão', 'issues = dirt')
  assert(sanitizeStoredPhotoIssues('Uma foto não mostra tudo, Gordura no piso') === 'Gordura no piso', 'stored issues sanitized')
  assert(sanitizeStoredPhotoIssues('Não dá para ver o grease trap') === null, 'stored coverage dropped')
}

function testPromptIsObjective() {
  const prompt = buildPhotoAiPrompt({
    locationName: 'Ibushio',
    cleaningType: 'deep',
    deepComponents: ALL_DEEP_COMPONENT_IDS,
    photoCount: 4,
    checklist: ['Grease trap', 'Range hood'],
  })
  assert(prompt.includes('SOMENTE o que está visível'), 'visible-only rule')
  assert(prompt.includes('NÃO liste como problema'), 'no coverage fail')
  assert(prompt.includes('DEEP CLEAN'), 'deep context')
  assert(prompt.includes('Fotos enviadas: 4'), 'photo count in prompt')
  assert(prompt.includes('NÃO exija que apareça na foto'), 'checklist is context only')

  const parsed = parsePhotoAiJson('```json\n{"nota":8,"aprovado":true,"problemas":[]}\n```')
  assert(parsed.nota === 8, 'fenced json')
}

function testEvaluateTrustsMarks() {
  const checklist = ['Floor', 'Trash', 'Grease trap', 'Hood']
  const marked = ['Floor', 'Trash', 'Grease trap', 'Hood']
  const prompt = buildEvaluateReportPrompt({
    report: 'Cleaned the shop, about 40 min.',
    checklist,
    jobTitle: 'Ibushio — Deep Clean',
    markedDone: marked,
  })
  assert(prompt.includes('MARCADOS PELO FUNCIONÁRIO'), 'marks in prompt')
  assert(prompt.includes('NÃO exija que cada item'), 'short report ok')

  const trusted = normalizeEvaluateResult(
    { nao_feitos: ['Floor', 'Trash', 'Grease trap', 'Hood'], resumo: 'Texto curto' },
    { checklist, markedDone: marked },
  )
  assert(trusted.nao_feitos.length === 0, `marked items not missed: ${trusted.nao_feitos}`)
  assert(trusted.itens_feitos === 4, `feitos ${trusted.itens_feitos}`)

  const partial = normalizeEvaluateResult(
    { nao_feitos: ['Floor'] },
    { checklist, markedDone: ['Floor', 'Trash'] },
  )
  assert(partial.nao_feitos.sort().join('|') === 'Grease trap|Hood', `unmarked only: ${partial.nao_feitos}`)
  assert(partial.itens_feitos === 2, '2 marked = 2 feitos')
}

function testI18n() {
  assert(kuripuroEn.employee.afterPhotosMin.includes('{n}'), 'en min key')
  assert(kuripuroEn.employee.afterPhotosHintDeep.toLowerCase().includes('dirt'), 'en deep hint objective')
  assert(kuripuroJa.employee.afterPhotosHintBasic.includes('減点しません'), 'ja basic no penalty')
  assert(fill(kuripuroEn.employee.afterPhotosMin, { n: 4 }).includes('4'), 'fill n')
  assert(kuripuroEn.employee.retroPhotoLabel.toLowerCase().includes('photos'), 'retro plural')
}

console.log('=== Photo AI (objective + multi-photo, no DB) ===\n')
testPackParse()
console.log('  pack/parse OK')
testMinPhotos()
console.log('  min after photos OK')
testCoverageComplaints()
console.log('  coverage complaints stripped OK')
testPromptIsObjective()
console.log('  prompt OK')
testEvaluateTrustsMarks()
console.log('  evaluate-report trusts marks OK')
testI18n()
console.log('  i18n OK')
console.log('\n✅ Photo AI tests passed')
