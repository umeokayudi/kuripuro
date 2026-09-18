import { getCleaningType, parseDeepComponents } from './cleaningType'
import { parsePhotoUrls } from './jobPhotoUrls'

export const PHOTO_AI_APPROVE_MIN = 7
export const PHOTO_AI_MAX_ANALYZE = 6
export const PHOTO_UPLOAD_MAX = 8

const COVERAGE_RE = /n[aã]o (mostra|mostra tudo|cobre|prova|aparece|est[aá] vis[ií]vel|foi fotograf|d[aá] para ver|da pra ver|[eé] poss[ií]vel ver)|faltam? (áreas?|itens?|c[oô]modos?|partes?|ambientes?)|uma (única )?foto|foto (única|s[oó]|s[oó] uma)|restaurante inteiro|loja inteira|estabelecimento inteiro|checklist (completo|todo|inteiro)|imposs[ií]vel ver (tudo|todos)|cannot (see|prove|cover) (everything|the whole|all)|doesn'?t (show|cover|prove) (everything|all|the whole)|does not (show|cover|prove)|missing (areas?|rooms?|items?|from the (frame|photo))|one (single )?photo|not (visible|shown|photographed|enough photos)|insufficient (coverage|to show)|1枚では|写真だけでは|全体(が|を)(見え|写)|チェックリスト(全部|全体|すべて)/i

export function isCoverageComplaint(text) {
  return COVERAGE_RE.test(String(text || ''))
}

export function minAfterPhotosForJob(job) {
  return minAfterPhotosForType(getCleaningType(job), parseDeepComponents(job).length)
}

export function minAfterPhotosForType(cleaningType, deepComponentCount = 0) {
  if (cleaningType === 'deep') {
    const n = deepComponentCount || 5
    return n >= 4 ? 4 : 3
  }
  return 1
}

export function buildPhotoAiPrompt({
  locationName,
  cleaningType = 'basic',
  deepComponents = [],
  photoCount = 1,
  checklist = [],
} = {}) {
  const deep = cleaningType === 'deep'
  const comps = (deepComponents || []).join(', ')
  const ck = (checklist || []).slice(0, 12).join('; ')
  return `Você é um inspetor de limpeza OBJETIVO de restaurante/bar.

Serviço: "${locationName || 'um local'}"
Tipo: ${deep ? 'DEEP CLEAN' : 'limpeza básica'}
Fotos enviadas: ${photoCount}${deep && comps ? `\nComponentes do deep: ${comps}` : ''}${ck ? `\nChecklist (contexto, NÃO exija que apareça na foto): ${ck}` : ''}

REGRAS OBRIGATÓRIAS:
1. Avalie SOMENTE o que está visível nas fotos. Uma foto não cobre o estabelecimento inteiro — isso é normal e NÃO é problema.
2. NÃO liste como problema e NÃO reprove por: "não mostra tudo", "faltam áreas", "uma foto não prova o checklist", "não dá para ver grease trap / todos os itens", "impossível ver o serviço completo".
3. "problemas" = sujeira VISÍVEL no quadro (lixo no chão, gordura óbvia, pia suja, poça, restos de comida). Sem sujeira visível → lista vazia.
4. Se as áreas fotografadas estiverem razoavelmente limpas, nota >= ${PHOTO_AI_APPROVE_MIN} e aprovado=true.
5. Várias fotos: julgue o CONJUNTO. Mais fotos aumentam confiança; não são prova de que algo faltou.
6. Deep clean: descreva em "cobertura" quais partes aparecem. Falta de cobertura NÃO vai para "problemas" e NÃO reprova.
7. Foto escura/embaçada: não invente sujeira. nota 6–7, aprovado=true, problemas=[].

Responda APENAS JSON válido:
{"nota": <1 a 10>, "aprovado": <true se nota >= ${PHOTO_AI_APPROVE_MIN}>, "problemas": [<sujeira visível, pt-BR>], "cobertura": "<1 frase: o que as fotos mostram>", "resumo": "<1 frase objetiva>"}`
}

export function parsePhotoAiJson(raw) {
  const cleaned = String(raw || '{}').replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      try { return JSON.parse(m[0]) } catch { /* ignore */ }
    }
    return { nota: null, aprovado: null, problemas: [], raw: cleaned }
  }
}

export function normalizePhotoAiResult(parsed = {}, { photoCount = 1 } = {}) {
  const problemas = (Array.isArray(parsed.problemas) ? parsed.problemas : [])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .filter(p => !isCoverageComplaint(p))
  let nota = Number(parsed.nota)
  if (!Number.isFinite(nota)) nota = problemas.length ? 6 : 8
  nota = Math.max(1, Math.min(10, Math.round(nota)))
  if (!problemas.length && nota < PHOTO_AI_APPROVE_MIN) nota = PHOTO_AI_APPROVE_MIN
  const aprovado = nota >= PHOTO_AI_APPROVE_MIN
  const cobertura = String(parsed.cobertura || '').trim()
  const resumo = String(parsed.resumo || '').trim()
  return {
    nota,
    aprovado,
    problemas,
    cobertura,
    resumo,
    fotos: photoCount,
  }
}

export function formatPhotoAiIssues(result) {
  if (!result) return null
  const dirt = (result.problemas || []).filter(Boolean).filter(p => !isCoverageComplaint(p))
  if (!dirt.length) return null
  return dirt.join(', ')
}

export function sanitizeStoredPhotoIssues(text) {
  if (!text) return null
  return formatPhotoAiIssues({ problemas: String(text).split(',').map(s => s.trim()).filter(Boolean) })
}

export function photoUrlsForAnalyze(value) {
  return parsePhotoUrls(value).slice(0, PHOTO_AI_MAX_ANALYZE)
}

export function buildEvaluateReportPrompt({
  report,
  checklist = [],
  jobTitle,
  markedDone = [],
} = {}) {
  const checklistItems = Array.isArray(checklist) ? checklist : []
  const marked = Array.isArray(markedDone) ? markedDone : []
  return `Você avalia um relatório curto de limpeza de restaurante/bar.

IMPORTANTE: valor, pagamento e desconto NÃO entram nesta análise.

Serviço: "${jobTitle || 'um local'}"

CHECKLIST (${checklistItems.length} itens):
${checklistItems.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(sem checklist)'}

${marked.length ? `ITENS MARCADOS PELO FUNCIONÁRIO (${marked.length}):\n${marked.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n` : ''}

RELATÓRIO:
"${report || ''}"

REGRAS:
1. Itens MARCADOS pelo funcionário contam como FEITOS, salvo o texto contradizer de forma explícita ("não fiz X", "pulei o grease trap").
2. O relatório é um resumo. NÃO exija que cada item do checklist seja nomeado no texto.
3. nao_feitos = somente itens NÃO marcados, ou marcados mas contraditos no texto.
4. Não critique o texto por ser curto se descreve o trabalho em linhas gerais.

JSON apenas:
{"itens_feitos": <número>, "itens_total": ${checklistItems.length}, "nao_feitos": [<rótulos>], "tempo_estimado_min": <número ou null>, "resumo": "<1 frase objetiva, sem dinheiro>"}`
}

export function normalizeEvaluateResult(parsed = {}, { checklist = [], markedDone = [] } = {}) {
  const items = Array.isArray(checklist) ? checklist.map(s => String(s)) : []
  const markedKeys = new Set((Array.isArray(markedDone) ? markedDone : []).map(s => String(s).trim().toLowerCase()))
  let missed
  if (markedKeys.size) {
    missed = items.filter(label => !markedKeys.has(label.trim().toLowerCase()))
  } else {
    const fromAi = new Set((Array.isArray(parsed.nao_feitos) ? parsed.nao_feitos : []).map(s => String(s).trim().toLowerCase()).filter(Boolean))
    missed = items.filter(label => fromAi.has(label.trim().toLowerCase()))
  }
  const feitos = items.length ? items.length - missed.length : Number(parsed.itens_feitos) || 0
  return {
    itens_feitos: feitos,
    itens_total: items.length || Number(parsed.itens_total) || 0,
    nao_feitos: missed,
    tempo_estimado_min: parsed.tempo_estimado_min ?? null,
    resumo: String(parsed.resumo || '').trim(),
  }
}
