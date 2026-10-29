import { useState } from 'react'
import toast from 'react-hot-toast'
import { useLang, pickLang } from '../hooks/useLang'
import { EVAL_CATEGORIES, COMPLAINT_LEVELS, pointsFor, saveEvaluation, removeEvaluation } from '../lib/evaluations'
import '../pages/evaluations.css'

/** Toast with an Undo button for a just-saved evaluation. */
export function toastSavedEvaluation({ row, newScore }, lang, onChange) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const pts = row.points_change
  toast(t => (
    <span className="ev-toast">
      {row.type === 'positive' ? '👍' : '👎'} {row.employee_name} {pts > 0 ? '+' : ''}{pts} pts → {newScore}
      <button type="button" onClick={async () => {
        toast.dismiss(t.id)
        try { await removeEvaluation(row); toast(L('Evaluation undone', '取り消しました', 'Avaliação desfeita')); onChange?.() } catch (e) { toast.error(e.message) }
      }}>{L('Undo', '取り消す', 'Desfazer')}</button>
    </span>
  ), { duration: 7000 })
}

/**
 * One-screen evaluation: 👍/👎, stars (or how serious), optional reasons and comment.
 * Pass `employee` (and `job`) when known; otherwise the admin taps the employee first.
 */
export default function EvaluationQuick({ employee: fixedEmployee, employees = [], job, initialType = 'positive', onSaved, onCancel }) {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [employeeId, setEmployeeId] = useState(fixedEmployee?.id || '')
  const [type, setType] = useState(initialType)
  const [stars, setStars] = useState(initialType === 'positive' ? 5 : 3)
  const [cats, setCats] = useState([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const employee = fixedEmployee || employees.find(e => e.id === employeeId)
  const pts = pointsFor(type, stars)

  const switchType = (next) => {
    setType(next)
    setStars(next === 'positive' ? 5 : 3)
    setCats([])
  }
  const toggleCat = key => setCats(c => (c.includes(key) ? c.filter(x => x !== key) : [...c, key]))

  const save = async () => {
    if (!employee) return toast.error(L('Pick the employee', '担当者を選んでください', 'Escolha o funcionário'))
    setSaving(true)
    try {
      const res = await saveEvaluation({ employee, job, type, stars, categories: cats, description: note })
      toastSavedEvaluation(res, lang, onSaved)
      onSaved?.(res)
    } catch (e) {
      toast.error(e.message)
    }
    setSaving(false)
  }

  return (
    <div className={`ev-quick ${type}`}>
      {!fixedEmployee && (
        <div className="ev-field">
          <div className="ev-label">{L('Who?', '誰？', 'Quem?')}</div>
          <div className="ev-chips">
            {employees.map(e => (
              <button key={e.id} type="button" className={`ev-chip${employeeId === e.id ? ' on' : ''}`} onClick={() => setEmployeeId(e.id)}>
                {employeeId === e.id ? '✓ ' : ''}{e.full_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ev-type">
        <button type="button" className={`ev-type-btn good${type === 'positive' ? ' on' : ''}`} onClick={() => switchType('positive')}>👍 {L('Good', '良い', 'Elogio')}</button>
        <button type="button" className={`ev-type-btn bad${type === 'complaint' ? ' on' : ''}`} onClick={() => switchType('complaint')}>👎 {L('Problem', '問題', 'Problema')}</button>
      </div>

      <div className="ev-field">
        {type === 'positive' ? (
          <div className="ev-stars" role="radiogroup" aria-label={L('Rating', '評価', 'Nota')}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" className={n <= stars ? 'on' : ''} onClick={() => setStars(n)} aria-label={`${n}`}>★</button>
            ))}
          </div>
        ) : (
          <div className="ev-levels">
            {COMPLAINT_LEVELS.map(l => (
              <button key={l.stars} type="button" className={`ev-chip${stars === l.stars ? ' on bad' : ''}`} onClick={() => setStars(l.stars)}>
                {pickLang(lang, l.en, l.ja, l.pt)} <small>{pointsFor('complaint', l.stars)}</small>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ev-field">
        <div className="ev-label">{L('Why? (optional)', '理由（任意）', 'Por quê? (opcional)')}</div>
        <div className="ev-chips">
          {EVAL_CATEGORIES[type].map(c => (
            <button key={c.key} type="button" className={`ev-chip${cats.includes(c.key) ? ` on ${type === 'positive' ? 'good' : 'bad'}` : ''}`} onClick={() => toggleCat(c.key)}>
              {c.icon} {pickLang(lang, c.key, c.ja, c.pt)}
            </button>
          ))}
        </div>
      </div>

      <textarea className="ev-note" rows={2} value={note} onChange={e => setNote(e.target.value)}
        placeholder={L('Comment (optional)', 'コメント（任意）', 'Comentário (opcional)')} />

      <div className="ev-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>{L('Cancel', 'キャンセル', 'Cancelar')}</button>}
        <button type="button" className={`btn ev-save ${type}`} onClick={save} disabled={saving}>
          {saving ? '…' : `${L('Save', '保存', 'Salvar')} ${type === 'positive' ? '👍' : '👎'} ${pts > 0 ? '+' : ''}${pts} pts`}
        </button>
      </div>
    </div>
  )
}
