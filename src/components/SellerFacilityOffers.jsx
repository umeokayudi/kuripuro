import './seller-facility-offers.css'
// Seller portal: Smart Facility services to offer — cleaning or maintenance that is late or due soon
// at the stores of this seller's clients. Kept in its own tab so it does not mix with the funnel.

const COPY = {
  en: {
    title: 'Services to offer',
    hint: 'Cleaning or maintenance that is late or due within 2 weeks at your clients’ stores. Offer it at the right time.',
    empty: 'Nothing to offer right now. Your clients’ stores are up to date.',
    offerTo: (task, client) => `Offer ${task} to ${client}`,
    notDoneFor: (n, i) => `Not done for ${n} days (every ${i} days)`,
    dueIn: (n, since) => `Due in ${n} days · last time ${since} days ago`,
    dueToday: 'Due today',
    late: 'Late',
    soon: 'Soon',
    offered: 'Already offered by the office',
    call: 'Call',
    seeAll: 'See all',
  },
  ja: {
    title: '提案するサービス',
    hint: '担当顧客の店舗で、期限切れまたは2週間以内に期限が来る清掃・メンテナンスです。タイミングよく提案しましょう。',
    empty: '今提案するサービスはありません。担当店舗はすべて最新です。',
    offerTo: (task, client) => `${client} に ${task} を提案`,
    notDoneFor: (n, i) => `${n}日間未実施（${i}日ごと）`,
    dueIn: (n, since) => `あと${n}日 · 前回から${since}日`,
    dueToday: '今日が期限',
    late: '期限切れ',
    soon: 'まもなく',
    offered: '事務所から提案済み',
    call: '電話',
    seeAll: 'すべて見る',
  },
}

export function offersCopy(lang) {
  return COPY[lang === 'ja' ? 'ja' : 'en']
}

function when(row, c) {
  if (row.status === 'overdue') return c.notDoneFor(row.daysSince, row.interval_days)
  if (row.daysLeft === 0) return c.dueToday
  return c.dueIn(row.daysLeft, row.daysSince)
}

export default function SellerFacilityOffers({ offers = [], lang, limit = 0, onSeeAll, className = '' }) {
  const c = offersCopy(lang)
  const shown = limit ? offers.slice(0, limit) : offers
  const late = offers.filter(r => r.status === 'overdue' && !r.offered).length
  return <section className={`fa-card sfo ${className}`}>
    <div className="fa-card-head"><h2>🧽 {c.title}</h2>{offers.length > 0 && <span className={`fa-pill${late ? ' sfo-pill-late' : ''}`}>{offers.length}</span>}</div>
    {!limit && <p className="fa-muted sfo-hint">{c.hint}</p>}
    {offers.length === 0 && <p className="fa-muted">{c.empty}</p>}
    <div className="sfo-list">
      {shown.map(r => <article key={r.key} className={`sfo-row st-${r.status}${r.offered ? ' is-offered' : ''}`}>
        <div className="sfo-main">
          <strong>{c.offerTo(r.task_name, r.client_name || r.location)}</strong>
          <small>{[r.location, r.element_name].filter(Boolean).join(' · ')}</small>
          <span className="sfo-when">🕒 {when(r, c)}</span>
          {r.offered && <span className="sfo-offered">✓ {c.offered}</span>}
        </div>
        <div className="sfo-side">
          <span className={`sfo-tag st-${r.status}`}>{r.task_type === 'maintenance' ? '🔧' : '🧽'} {r.status === 'overdue' ? c.late : c.soon}</span>
          {r.phone && <a className="fa-btn fa-btn-sm" href={`tel:${r.phone}`}>📞 {c.call}</a>}
        </div>
      </article>)}
    </div>
    {limit > 0 && offers.length > limit && onSeeAll && <button type="button" className="fa-link" onClick={onSeeAll}>{c.seeAll} ›</button>}
  </section>
}
