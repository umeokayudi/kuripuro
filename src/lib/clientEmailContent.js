// v1.0.213 · E-mail de confirmação com relatórios ao cliente — texto (puro, sem imports, roda no
// servidor e nos testes). Recebe só o que pode ir para o cliente: loja, tipo, horários, responsável
// e as notas do relatório. Nunca recebe valor do serviço, pagamento do funcionário nem outro cliente.

export const EMAIL_LANGS = ['ja', 'en', 'pt']

const pick = (lang, ja, en, pt) => (lang === 'en' ? en : lang === 'pt' ? pt : ja)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Store name from a job title ("児玉 錦糸町 — Basic Cleaning" → "児玉 錦糸町"). */
export const storeFromTitle = title => String(title || '').replace(/ — .*/, '').trim()

/** 'spot' | 'deep' | 'basic' (same rules as cleaningType.getCleaningType). */
export function serviceKind(job) {
  if (job?.job_category === 'spot') return 'spot'
  const t = `${job?.title || ''} ${job?.description || ''}`.toLowerCase()
  if (/deep\s*clean|profunda|limpeza profunda/.test(t)) return 'deep'
  if (/range hood|grease trap|grating|ac cleaning|stove|fog[aã]o|レンジフード|グリストラップ|コンロ/.test(t)) return 'deep'
  return 'basic'
}

export function kindLabel(kind, lang = 'ja') {
  if (kind === 'spot') return pick(lang, 'スポット清掃', 'Spot cleaning', 'Limpeza spot')
  if (kind === 'deep') return pick(lang, 'ディープクリーニング', 'Deep cleaning', 'Limpeza pesada')
  return pick(lang, '定期清掃', 'Regular cleaning', 'Limpeza regular')
}

// Deep-clean task names as they appear in job titles → client language (same as cleaningType.DEEP_TASKS).
const TASKS = {
  'range hood': ['レンジフード', 'Coifa'], 'grease trap': ['グリストラップ', 'Caixa de gordura'], grating: ['グレーティング', 'Grelhas de piso'],
  stove: ['コンロ', 'Fogão'], 'ac cleaning': ['エアコン', 'Ar-condicionado'], ac: ['エアコン', 'Ar-condicionado'], fryer: ['フライヤー', 'Fritadeira'],
  'kitchen equipment': ['厨房機器', 'Equipamentos da cozinha'], fridge: ['冷蔵庫', 'Geladeira'], 'walls & tiles': ['壁・タイル', 'Paredes e azulejos'],
  'floor scrub': ['床の洗浄', 'Lavar piso'], drains: ['排水溝', 'Ralos'], restroom: ['トイレ', 'Banheiro completo'], windows: ['窓ガラス', 'Vidros e janelas'],
  'ceiling & lights': ['天井・照明', 'Teto e luminárias'], 'seats & sofas': ['椅子・ソファ', 'Cadeiras e sofás'], 'floor wax': ['床ワックス', 'Cera no piso'],
}
const taskName = (t, lang) => { const k = TASKS[t.trim().toLowerCase()]; return k && lang !== 'en' ? k[lang === 'pt' ? 1 : 0] : t.trim() }

/** What was done, from the title: "Deep Clean (Range hood, Grease trap)" → "レンジフード、グリストラップ". */
export function detailFromTitle(title, lang = 'ja') {
  const parts = String(title || '').split(' — ')
  let d = parts.slice(1).join(' — ').trim()
  if (!d || /^basic( cleaning)?$/i.test(d)) return ''
  d = d.replace(/^deep\s*clean(ing)?\s*/i, '').replace(/^\((.*)\)$/, '$1').trim()
  if (!d) return ''
  return d.split(/\s*[,、]\s*/).filter(Boolean).map(t => taskName(t, lang)).join(lang === 'ja' ? '、' : ', ')
}

/** HH:MM in Japan time ('' when missing). */
export function jstTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
}

/** "2026年11月12日（木）" / "Thu, 12 Nov 2026" / "qui., 12/11/2026". */
export function longDate(date, lang = 'ja') {
  const d = new Date(`${String(date).slice(0, 10)}T12:00:00+09:00`)
  if (Number.isNaN(d.getTime())) return String(date || '')
  if (lang === 'ja') {
    const [y, m, dd] = String(date).slice(0, 10).split('-').map(Number)
    const w = '日月火水木金土'[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]
    return `${y}年${m}月${dd}日（${w}）`
  }
  return d.toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tokyo' })
}

/** Short date for the subject: 2026/11/12. */
export const subjectDate = date => String(date || '').slice(0, 10).replace(/-/g, '/')

/**
 * Turns one job (+ its report notes) into the only fields the e-mail may show.
 * Anything else on the job row (value, spot_value, employee_pay…) is dropped here.
 */
export function serviceLine(job, { notes = '', lang = 'ja' } = {}) {
  const kind = serviceKind(job)
  const detail = detailFromTitle(job?.title, lang)
  return {
    job_id: job?.id || null,
    store: storeFromTitle(job?.title) || job?.client_name || '—',
    kind,
    type: detail && kind !== 'basic' ? `${kindLabel(kind, lang)}（${detail}）` : kindLabel(kind, lang),
    start: jstTime(job?.started_at),
    end: jstTime(job?.completed_at),
    staff: String(job?.employee_name || '').trim(),
    notes: String(notes || '').trim(),
    done: job?.status === 'completed',
  }
}

/** Splits e-mail text like "a@x.jp, b@y.jp; c@z.jp" into a clean, de-duplicated list. */
export function parseEmails(...values) {
  const out = []
  for (const v of values) {
    for (const part of String(v || '').split(/[\s,;、，／/]+/)) {
      const e = part.trim().toLowerCase()
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !out.includes(e)) out.push(e)
    }
  }
  return out
}

/** Recipients of a client: the contact e-mails saved in the client record. */
export const clientRecipients = client => parseEmails(client?.email, client?.manager_email)

const SIGN = {
  ja: ['Umeoka Group / KuriPuro（クリプロ）', '清掃サービス担当'],
  en: ['Umeoka Group / KuriPuro', 'Cleaning services'],
  pt: ['Umeoka Group / KuriPuro', 'Serviços de limpeza'],
}

/**
 * Builds the e-mail.
 * @param {object} p
 * @param {'day'|'spot'} p.kind
 * @param {{company_name:string, contact_name?:string}} p.client
 * @param {string} p.date YYYY-MM-DD (Japan)
 * @param {Array} p.services serviceLine() of the finished services
 * @param {Array} [p.notDone] serviceLine() of the services marked "não feito"
 * @param {'pdf'|'link'} p.delivery whether the reports go attached or only via the portal link
 * @param {string} p.portalUrl
 * @param {{email?:string, phone?:string}} [p.contact] office contact for the signature
 */
export function buildClientEmail({ kind = 'day', client, date, services = [], notDone = [], delivery = 'pdf', portalUrl = '', contact = {}, lang = 'ja' }) {
  const L = EMAIL_LANGS.includes(lang) ? lang : 'ja'
  const company = String(client?.company_name || '').trim()
  const person = String(client?.contact_name || '').trim()
  const n = services.length
  const total = n + notDone.length
  const dateTxt = longDate(date, L)
  const subject = pick(L,
    `作業完了のご報告（${subjectDate(date)}）— ${company}`,
    `Service completion report (${subjectDate(date)}) — ${company}`,
    `Relatório de conclusão do serviço (${subjectDate(date)}) — ${company}`)

  const greeting = pick(L,
    [`${company} 御中`, person ? `${person} 様` : ''].filter(Boolean),
    [`Dear ${person || company},`],
    [`Prezado(a) ${person || company},`])

  const intro = pick(L,
    ['いつも大変お世話になっております。KuriPuro（Umeoka Group）でございます。', '平素より清掃業務をご用命いただき、誠にありがとうございます。'],
    [`Thank you for trusting KuriPuro (Umeoka Group) with the cleaning of ${company}.`],
    [`Agradecemos por confiar à KuriPuro (Umeoka Group) a limpeza da ${company}.`])

  let summary
  if (kind === 'spot') {
    summary = pick(L,
      `${dateTxt}にご依頼いただきましたスポット清掃が完了いたしましたので、ご報告申し上げます。`,
      `The spot cleaning you requested was completed on ${dateTxt}.`,
      `A limpeza spot que vocês solicitaram foi concluída em ${dateTxt}.`)
  } else if (!notDone.length) {
    summary = pick(L,
      `本日${dateTxt}、${n}件すべての清掃が完了いたしましたので、ご報告申し上げます。`,
      `Today, ${dateTxt}, all ${n} cleaning service${n === 1 ? '' : 's'} ${n === 1 ? 'was' : 'were'} completed.`,
      `Hoje, ${dateTxt}, ${n === 1 ? 'o serviço de limpeza foi concluído' : `todos os ${n} serviços de limpeza foram concluídos`}.`)
  } else {
    summary = pick(L,
      `本日${dateTxt}、ご予定の${total}件のうち${n}件の清掃が完了いたしましたので、ご報告申し上げます。`,
      `Today, ${dateTxt}, ${n} of the ${total} scheduled cleaning services were completed.`,
      `Hoje, ${dateTxt}, ${n} dos ${total} serviços de limpeza programados foram concluídos.`)
  }

  const T = {
    head: pick(L, '■ 作業内容', '■ Services', '■ Serviços'),
    store: pick(L, '店舗', 'Store', 'Loja'),
    type: pick(L, '作業内容', 'Service', 'Tipo'),
    time: pick(L, '作業時間', 'Time', 'Horário'),
    staff: pick(L, '担当', 'Done by', 'Responsável'),
    notes: pick(L, '備考', 'Notes', 'Observações'),
    notDoneHead: pick(L, '■ 未実施', '■ Not carried out', '■ Não realizado'),
    notDone: pick(L, '未実施', 'not carried out', 'não realizado'),
    reports: delivery === 'pdf'
      ? pick(L, '各店舗の作業報告書（作業前・作業後の写真を含む）を PDF にて添付しております。ご確認くださいますようお願い申し上げます。',
        'The full service reports (with before and after photos) are attached as a PDF.',
        'Os relatórios completos (com fotos de antes e depois) seguem anexos em PDF.')
      : pick(L, '各店舗の作業報告書（作業前・作業後の写真を含む）は、下記のお客様ポータルよりご確認いただけます。',
        'The full service reports (with before and after photos) are available in your client portal below.',
        'Os relatórios completos (com fotos de antes e depois) estão no portal do cliente, no link abaixo.'),
    closing: pick(L,
      ['ご不明な点やお気づきの点がございましたら、お気軽にお申し付けください。', '今後とも変わらぬご愛顧を賜りますよう、よろしくお願い申し上げます。'],
      ['If you have any questions or notice anything, please let us know.', 'Thank you again for your trust.'],
      ['Se tiverem qualquer dúvida ou observação, é só nos avisar.', 'Agradecemos mais uma vez pela confiança.']),
    portal: pick(L, 'お客様ポータル', 'Client portal', 'Portal do cliente'),
    stop: pick(L,
      '本メールの配信停止をご希望の場合は、本メールにご返信いただくか、担当者までお申し付けください。',
      'To stop receiving these e-mails, just reply to this message or tell your KuriPuro contact.',
      'Para deixar de receber estes e-mails, basta responder a esta mensagem ou pedir ao seu contato na KuriPuro.'),
    auto: pick(L, '※本メールは作業完了時に自動でお送りしています。', 'This e-mail is sent automatically when the work is finished.', 'Este e-mail é enviado automaticamente quando o serviço termina.'),
  }
  const timeOf = s => (s.start || s.end ? `${s.start || '—'}〜${s.end || '—'}` : '—')
  const sign = [...SIGN[L], contact.email || '', contact.phone ? `TEL ${contact.phone}` : ''].filter(Boolean)

  // ── plain text ──
  const textServices = services.map((s, i) => [
    `${i + 1}. ${s.store}`,
    `   ${T.type}：${s.type}`,
    `   ${T.time}：${timeOf(s)}`,
    s.staff ? `   ${T.staff}：${s.staff}` : '',
    s.notes ? `   ${T.notes}：${s.notes.replace(/\n+/g, '\n      ')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
  const textNotDone = notDone.length ? `\n\n${T.notDoneHead}\n${notDone.map(s => `・${s.store}（${s.type}）— ${T.notDone}`).join('\n')}` : ''
  const text = [
    ...greeting, '',
    ...intro, '',
    summary, '',
    T.head, textServices + textNotDone, '',
    T.reports, '',
    ...T.closing, '',
    '──────────', ...sign, '',
    portalUrl ? `${T.portal}：${portalUrl}` : '',
    T.stop, T.auto,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim()

  // ── HTML ──
  const row = (k, v) => `<tr><td style="padding:2px 12px 2px 0;color:#64748b;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:2px 0;vertical-align:top">${v}</td></tr>`
  const htmlServices = services.map((s, i) => `
<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin:0 0 10px">
  <div style="font-weight:700;font-size:15px;margin-bottom:6px">${i + 1}. ${esc(s.store)}</div>
  <table style="border-collapse:collapse;font-size:14px">
    ${row(T.type, esc(s.type))}
    ${row(T.time, esc(timeOf(s)))}
    ${s.staff ? row(T.staff, esc(s.staff)) : ''}
    ${s.notes ? row(T.notes, esc(s.notes).replace(/\n/g, '<br>')) : ''}
  </table>
</div>`).join('')
  const htmlNotDone = notDone.length ? `
<p style="font-weight:700;margin:18px 0 6px">${esc(T.notDoneHead)}</p>
<ul style="margin:0;padding-left:20px;color:#475569">${notDone.map(s => `<li>${esc(s.store)}（${esc(s.type)}）— ${esc(T.notDone)}</li>`).join('')}</ul>` : ''
  const p = t => `<p style="margin:0 0 12px">${esc(t)}</p>`
  const html = `<!doctype html><html lang="${L}"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f8fafc;font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',Meiryo,Arial,sans-serif;color:#0f172a;line-height:1.7">
<div style="max-width:640px;margin:0 auto;background:#ffffff;padding:28px 24px">
${greeting.map(p).join('')}
${intro.map(p).join('')}
${p(summary)}
<p style="font-weight:700;margin:18px 0 8px">${esc(T.head)}</p>
${htmlServices}
${htmlNotDone}
<p style="margin:18px 0 12px">${esc(T.reports)}</p>
${T.closing.map(p).join('')}
<div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:12px;font-size:13px;color:#334155">${sign.map(esc).join('<br>')}</div>
<div style="margin-top:18px;font-size:12px;color:#64748b">
${portalUrl ? `${esc(T.portal)}：<a href="${esc(portalUrl)}" style="color:#2563eb">${esc(portalUrl)}</a><br>` : ''}
${esc(T.stop)}<br>${esc(T.auto)}
</div>
</div></body></html>`

  return { subject, text, html, lang: L }
}
