import { useEffect, useState } from 'react'
import { useLang, pickLang } from '../hooks/useLang'
import { fetchQuoteSessions, quoteProgress, QUOTE_FLOW_CHANGED } from '../lib/quoteFlow'
import './quote-tracker.css'

// v1.0.86 · One line on an accepted quote card: 5 steps + what is missing now (late in red).
// Pass sessions when the page already loaded them, or just quoteRef and it loads them itself.
export default function QuoteProgress({ quoteRef, sessions: given, onOpen }) {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [own, setOwn] = useState(null)

  useEffect(() => {
    if (given || !quoteRef) return undefined
    const load = () => fetchQuoteSessions(quoteRef).then(setOwn).catch(() => setOwn([]))
    load()
    window.addEventListener(QUOTE_FLOW_CHANGED, load)
    return () => window.removeEventListener(QUOTE_FLOW_CHANGED, load)
  }, [quoteRef, given])

  const sessions = given || own
  if (!sessions) return null
  const p = quoteProgress(sessions)
  const all = n => p.booked > 0 && n === p.booked
  const dots = [true, p.booked > 0, all(p.done), all(p.checked), all(p.billChecked)]

  let text
  if (p.late) text = ['⚠', L(`Late: ${p.late} not done on its day`, `遅延：${p.late}件 未実施`, `Atrasado: ${p.late} não feito no dia`)]
  else if (!p.booked) text = ['📅', L('Book the date', '日程が未定です', 'Falta marcar a data')]
  else if (p.done < p.booked) text = ['📅', L(`Booked for ${p.next}`, `${p.next} に予定`, `Marcado para ${p.next}`)]
  else if (p.checked < p.done) text = ['📝', L('Done · check how it went', '完了・内容を確認してください', 'Feito · falta conferir como foi')]
  else if (p.billChecked < p.booked) text = ['🧾', p.billed < p.booked ? L('Invoice not sent yet', '請求書未送付', 'Nota ainda não enviada') : L('Check the billing', '請求を確認してください', 'Falta checar a cobrança')]
  else text = ['✓', L('All done · billing checked', 'すべて完了・請求確認済み', 'Tudo concluído · cobrança checada')]

  return (
    <button type="button" className={`qp${p.late ? ' is-late' : ''}`} onClick={onOpen}>
      <span className="qp-dots" aria-hidden="true">
        {dots.map((on, i) => <i key={i} className={i === 2 && p.late ? 'late' : on ? 'on' : ''} />)}
      </span>
      <b>{text[0]} {text[1]}</b>
      {p.booked > 0 && <span>{L(`${p.done}/${p.booked} done`, `${p.done}/${p.booked} 完了`, `${p.done}/${p.booked} feito`)}</span>}
    </button>
  )
}
