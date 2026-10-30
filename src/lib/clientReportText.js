// v1.0.106 · Words of the client report, in the three languages. Shared by the screen
// (admin preview + client portal) and the PDF. Dates only — never a time.

const T = {
  title: ['Monthly service report', '月次清掃レポート', 'Relatório mensal de serviços'],
  period: ['Period', '対象期間', 'Período'],
  locations: ['Locations served', '対応店舗', 'Locais atendidos'],
  services: ['Services completed', '完了した作業', 'Serviços concluídos'],
  basicDeep: ['Basic × deep', '通常 × ディープ', 'Básicas × pesadas'],
  spot: ['Spot', 'スポット', 'Spot'],
  basic: ['Basic cleaning', '通常清掃', 'Limpeza básica'],
  deep: ['Deep cleaning', 'ディープクリーン', 'Limpeza pesada'],
  by: ['Done by', '担当', 'Feito por'],
  before: ['Before', 'ビフォー', 'Antes'],
  after: ['After', 'アフター', 'Depois'],
  video: ['Post-cleaning video', '清掃後の動画', 'Vídeo pós-limpeza'],
  videoPortal: ['Watch on the client portal', 'お客様ポータルで再生', 'Assistir no portal do cliente'],
  checklist: ['Checklist', 'チェックリスト', 'Checklist'],
  checklistOf: ['{x} of {y} items done', '{y}項目中{x}項目完了', '{x} de {y} itens feitos'],
  notes: ['Notes', 'メモ', 'Observações'],
  next: ['Next scheduled', '今後の予定', 'Próximos agendados'],
  noNext: ['Nothing scheduled yet.', '予定はまだありません。', 'Nada agendado ainda.'],
  noService: ['No service this month.', '今月の作業はありません。', 'Nenhum serviço neste mês.'],
  deepState: ['Deep cleaning', 'ディープクリーン', 'Limpeza pesada'],
  lastDone: ['last done', '前回', 'última feita'],
  nextExpected: ['next', '次回', 'próxima'],
  none: ['—', '—', '—'],
  footer: ['KuriPuro · cleaning report', 'クリプロ · 清掃レポート', 'KuriPuro · relatório de limpeza'],
}

const idx = lang => (lang === 'ja' ? 1 : lang === 'pt' ? 2 : 0)

export function rt(lang, key, vars) {
  let s = (T[key] || [key, key, key])[idx(lang)]
  for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, v)
  return s
}

const locale = lang => (lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB')

/** "Fri, 3 Oct" — the day only, in Tokyo. */
export function reportDay(day, lang, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!day) return '—'
  return new Date(`${day}T12:00:00+09:00`).toLocaleDateString(locale(lang), { ...opts, timeZone: 'Asia/Tokyo' })
}

/** "October 2026" */
export function reportMonth(period, lang) {
  if (!period) return ''
  return new Date(`${period}-15T12:00:00+09:00`).toLocaleDateString(locale(lang), { month: 'long', year: 'numeric', timeZone: 'Asia/Tokyo' })
}

export function typeLabel(type, lang) {
  return rt(lang, type === 'deep' ? 'deep' : type === 'spot' ? 'spot' : 'basic')
}
