// v1.0.174 · Box inside the employee's "Próximo turno" card: probable total time + ideal start.
import { fmtDur } from '../lib/shiftEstimate'

export default function ShiftEstimateBox({ est, L }) {
  if (!est) return null
  const basis = est.fromHistory === est.count
    ? L('based on your past visits', 'これまでの実績から', 'pelo seu histórico nesses locais')
    : est.fromHistory > 0
      ? L(`${est.fromHistory} of ${est.count} from your history, the rest planned time`, `${est.count}件中${est.fromHistory}件は実績、残りは予定時間`, `${est.fromHistory} de ${est.count} pelo seu histórico, o resto pelo tempo previsto`)
      : L('planned time (no history yet)', '予定時間（実績なし）', 'tempo previsto (ainda sem histórico)')
  const travel = est.travelMin > 0 ? L(` · incl. ${est.travelMin} min travel`, `・移動${est.travelMin}分を含む`, ` · inclui ${est.travelMin} min de deslocamento`) : ''
  return (
    <div className="emp-shift-est" role="group" aria-label={L('Shift estimate', 'シフトの見込み', 'Estimativa do turno')}>
      <div className="emp-shift-est-row">
        <span className="emp-shift-est-label">⏱ {L('Whole shift', 'シフト全体', 'Turno inteiro')}</span>
        <strong>≈ {fmtDur(est.totalMin)}</strong>
      </div>
      {est.idealStart ? (
        <div className="emp-shift-est-row is-start">
          <span className="emp-shift-est-label">▶ {L('Ideal start', '理想の開始', 'Ideal começar')}</span>
          <strong>{est.tight ? L(`at ${est.idealStart} (as soon as it opens)`, `${est.idealStart}（開始と同時に）`, `às ${est.idealStart} (assim que abrir)`) : L(`by ${est.idealStart}`, `${est.idealStart}まで`, `até ${est.idealStart}`)}</strong>
        </div>
      ) : est.end ? (
        <div className="emp-shift-est-row">
          <span className="emp-shift-est-label">🏁 {L('Probable end', '終了見込み', 'Termina por volta de')}</span>
          <strong>{est.end}</strong>
        </div>
      ) : null}
      <div className="emp-shift-est-note">
        {est.idealStart && !est.tight ? L(`Finish by ${est.deadline} with ${30} min to spare · `, `${est.deadline}までに30分の余裕 · `, `Termina antes das ${est.deadline} com 30 min de folga · `) : ''}
        {est.tight ? L(`Tight: the estimate barely fits before ${est.deadline} · `, `${est.deadline}までギリギリです · `, `Apertado: mal cabe até ${est.deadline} · `) : ''}
        {basis}{travel}
      </div>
    </div>
  )
}
