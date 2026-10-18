import { useState } from 'react'
import { ELEMENT_KINDS, taskState } from '../../lib/facilityModel'
import { fill } from '../../hooks/useLang'

/** "3 dias atrasado" / "em 12 dias" / "nunca registrado" para uma linha da agenda. */
export function careWhen(row, t) {
  if (row.status === 'none') return t.never
  if (row.daysLeft == null) return ''
  if (row.daysLeft < 0) return fill(t.daysLate, { n: -row.daysLeft })
  if (row.daysLeft === 0) return t.today
  return fill(t.inDays, { n: row.daysLeft })
}

export function fmtDay(iso, lang) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00+09:00').toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tokyo' })
}

/** Linhas de uma tarefa avulsa (popup de um item): junta a situação calculada. */
export function rowsForElement(el, care, now = new Date()) {
  return care.map(task => ({ element: el, task, ...taskState(task, now) })).filter(r => r.status)
}

/**
 * Lista de limpezas e manutenções: tipo, o que é, última vez, próxima e situação (cor).
 * showElement mostra o nome do equipamento (agenda da loja); renderActions(row) põe botões na linha.
 */
export default function CareList({ rows, t, lang, showElement = false, onElement, renderActions, limit = 0, dark = false }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const shown = limit && !all ? rows.slice(0, limit) : rows
  return (
    <div className={`fac-care${dark ? ' dark' : ''}`}>
      {shown.map(r => {
        const k = ELEMENT_KINDS[r.element.kind] || ELEMENT_KINDS.other
        return (
          <div key={`${r.element.id}:${r.task.id}`} className={`fac-care-row st-${r.status}`}>
            <span className="fac-care-dot" />
            <div className="fac-care-main">
              {showElement && (
                <button type="button" className="fac-care-el" onClick={() => onElement?.(r.element)}>
                  {k.icon} {r.element.name}
                </button>
              )}
              <div className="fac-care-task">
                <span className={`fac-care-type ${r.task.type}`}>{r.task.type === 'maintenance' ? '🔧' : '🧽'} {r.task.type === 'maintenance' ? t.maintenance : t.cleaning}</span>
                {r.task.name}
              </div>
              <div className="fac-care-dates">
                {t.lastDone}: <b>{r.task.last ? fmtDay(r.task.last, lang) : t.never}</b>
                {r.next && <> · {t.nextDue}: <b>{fmtDay(r.next, lang)}</b></>}
                {r.status !== 'none' && <span className="fac-care-when"> · {careWhen(r, t)}</span>}
              </div>
            </div>
            {renderActions && <div className="fac-care-actions">{renderActions(r)}</div>}
          </div>
        )
      })}
      {limit > 0 && rows.length > limit && (
        <button type="button" className="fac-care-more" onClick={() => setAll(v => !v)}>
          {all ? t.showLess : fill(t.showAll, { n: rows.length })}
        </button>
      )}
    </div>
  )
}
