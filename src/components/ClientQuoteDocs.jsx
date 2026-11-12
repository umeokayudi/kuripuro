// v1.0.211 · Client portal → Quotes: the 見積書 the office sent (table `mitsumori`), with number, lines,
// totals and status. A sent quote can be answered Accept / Decline here; the office sees it at once.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { pickLang, localeOf } from '../hooks/useLang'
import { askConfirm } from './ConfirmDialog'
import { answerClientQuote, quoteExpired } from '../lib/clientQuotes'
import { buildMitsumoriPrintHtml, notesForPrint } from '../lib/sales'
import { openPrintHtml } from '../lib/openPrintHtml'
import { proposalHtml } from '../lib/proposal'
import QuoteAttachments from './QuoteAttachments'

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`
const fmtDate = (iso, lang) => iso
  ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : '—'

export function ClientQuoteDoc({ quote, lang, today, who, onChanged }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(quote.status === 'sent')
  const expired = quoteExpired(quote, today)
  const pill = expired ? [L('Expired', '期限切れ', 'Vencido'), 'muted']
    : ({
      sent: [L('Waiting for your answer', 'ご回答待ち', 'Aguardando sua resposta'), 'soon'],
      accepted: [L('Accepted', '承認済み', 'Aceito'), 'paid'],
      declined: [L('Declined', '見送り', 'Recusado'), 'muted'],
      expired: [L('Expired', '期限切れ', 'Vencido'), 'muted'],
    })[quote.status] || [quote.status, 'open']
  const notes = notesForPrint(quote.notes)

  const decide = async decision => {
    const yes = decision === 'accepted'
    const ans = await askConfirm({
      title: yes ? L('Accept this quote?', 'この見積もりを承認しますか？', 'Aceitar este orçamento?') : L('Decline this quote?', 'この見積もりを見送りますか？', 'Recusar este orçamento?'),
      message: `${quote.quote_number || ''} · ${yen(quote.total)}`,
      confirmLabel: yes ? L('Accept', '承認する', 'Aceitar') : L('Decline', '見送る', 'Recusar'),
      danger: !yes,
      ...(yes ? {} : { reason: L('Reason (optional)', '理由（任意）', 'Motivo (opcional)'), reasonRequired: false }),
    })
    if (!ans) return
    setBusy(true)
    try {
      await answerClientQuote(quote, decision, { who, reason: typeof ans === 'string' ? ans : '' })
      toast.success(yes ? L('Thank you! We will contact you to schedule.', 'ありがとうございます。日程調整のご連絡をいたします。', 'Obrigado! Vamos entrar em contato para agendar.') : L('Answer sent.', '回答を送信しました。', 'Resposta enviada.'))
      onChanged?.()
    } catch (err) {
      toast.error(String(err?.message || err).slice(0, 160))
    } finally { setBusy(false) }
  }

  const openDoc = () => {
    const opened = openPrintHtml(buildMitsumoriPrintHtml(quote, quote.items || [], {}, lang === 'ja' ? 'ja' : lang))
    if (!opened?.ok) toast.error(L('Allow pop-ups to open the document.', 'ポップアップを許可してください。', 'Permita pop-ups para abrir o documento.'))
  }

  const openProposal = () => {
    // the sheet is a fixed 1600px landscape page: on screen it shrinks to the window width (print is untouched)
    const fit = '<style>@media screen{html,body{overflow-x:hidden}}</style><script>(function(){function f(){var w=document.documentElement.clientWidth;var s=Math.min(1,w/1640);document.body.style.zoom=s<1?String(s):""}addEventListener("load",f);addEventListener("resize",f);if(document.body)f()})()</script>'
    const html = proposalHtml(quote.proposal).replace('</body>', `${fit}</body>`)
    const opened = openPrintHtml(html)
    if (!opened?.ok) toast.error(L('Allow pop-ups to open the document.', 'ポップアップを許可してください。', 'Permita pop-ups para abrir o documento.'))
  }

  return (
    <article className="cpx-request cpq-doc">
      <button type="button" className="cpq-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <div>
          <strong>{L('Quote', '見積書', 'Orçamento')} {quote.quote_number || ''}</strong>
          <small>{[quote.site_name, `${L('Issued', '発行日', 'Emitido')} ${fmtDate(quote.issue_date || quote.sent_at, lang)}`].filter(Boolean).join(' · ')}</small>
        </div>
        <span className="cpq-head-right">
          <span className={`cpx-pill is-${pill[1]}`}>{pill[0]}</span>
          <b>{yen(quote.total)}</b>
        </span>
      </button>
      {open && (
        <div className="cpq-body">
          <table className="cpq-lines">
            <thead><tr><th>{L('Item', '品目', 'Item')}</th><th>{L('Qty', '数量', 'Qtd.')}</th><th>{L('Unit', '単価', 'Unitário')}</th><th>{L('Amount', '金額', 'Valor')}</th></tr></thead>
            <tbody>
              {(quote.items || []).map(it => (
                <tr key={it.id}><td>{it.description}</td><td>{it.quantity}</td><td>{yen(it.unit_price)}</td><td>{yen(it.total)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="cpq-totals">
            <span>{L('Subtotal', '小計', 'Subtotal')}<b>{yen(quote.subtotal)}</b></span>
            <span>{L('Tax', '消費税', 'Imposto')} ({quote.tax_rate ?? 10}%)<b>{yen(quote.tax_amount)}</b></span>
            <span className="is-total">{L('Total', '合計', 'Total')}<b>{yen(quote.total)}</b></span>
          </div>
          <div className="cpq-meta">
            {quote.valid_until && <span>{L('Valid until', '有効期限', 'Válido até')}: {fmtDate(quote.valid_until, lang)}</span>}
            {quote.decided_at && quote.status !== 'sent' && <span>{L('Answered', '回答日', 'Respondido em')}: {fmtDate(quote.decided_at, lang)}</span>}
          </div>
          {notes && <div className="cpq-notes"><small>{L('Notes', '備考', 'Observações')}</small><p>{notes}</p></div>}
          {quote.attachments?.length > 0 && <QuoteAttachments quoteId={quote.id} lang={lang} files={quote.attachments} />}
          <div className="cpx-row-btns">
            <button type="button" className="cp-btn" onClick={openDoc}>📄 {L('見積書 (PDF)', '見積書（PDF）', '見積書 (PDF)')}</button>
            {quote.proposal && <button type="button" className="cp-btn" onClick={openProposal}>🎨 {L('Visual proposal', '提案書を見る', 'Proposta visual')}</button>}
            {quote.status === 'sent' && !expired && (
              <>
                <button type="button" className="cp-btn" disabled={busy} onClick={() => decide('declined')}>{L('Decline', '見送る', 'Recusar')}</button>
                <button type="button" className="cp-btn cp-btn-blue" disabled={busy} onClick={() => decide('accepted')}>{L('Accept', '承認する', 'Aceitar')}</button>
              </>
            )}
          </div>
          {expired && <p className="cpq-hint">{L('This quote is past its validity date. Ask us in the chat for an updated one.', '有効期限を過ぎています。チャットで再発行をご依頼ください。', 'Este orçamento passou da validade. Peça um novo pelo chat.')}</p>}
        </div>
      )}
    </article>
  )
}

export const CLIENT_QUOTE_CSS = `
.cpq-doc{padding:0;overflow:hidden}
.cpq-head{all:unset;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;padding:14px 16px;cursor:pointer}
.cpq-head>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.cpq-head small{color:var(--cp-muted,#64748b);font-size:12px;overflow-wrap:anywhere}
.cpq-head-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}
.cpq-head-right b{font-size:16px}
.cpq-body{padding:0 16px 14px;display:flex;flex-direction:column;gap:10px}
.cpq-lines{width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed}
.cpq-lines th{font-size:11px;font-weight:600;color:var(--cp-muted,#64748b);text-align:right;padding:6px 4px;border-bottom:1px solid rgba(148,163,184,.35)}
.cpq-lines td{padding:7px 4px;text-align:right;border-bottom:1px solid rgba(148,163,184,.18);vertical-align:top}
.cpq-lines th:first-child,.cpq-lines td:first-child{text-align:left;width:46%;overflow-wrap:anywhere}
.cpq-totals{display:flex;flex-direction:column;gap:3px;align-items:flex-end;font-size:13px}
.cpq-totals span{display:flex;gap:16px}
.cpq-totals b{min-width:96px;text-align:right}
.cpq-totals .is-total{font-size:15px;font-weight:700}
.cpq-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--cp-muted,#64748b)}
.cpq-notes small{font-size:11px;color:var(--cp-muted,#64748b)}
.cpq-notes p{margin:2px 0 0;white-space:pre-wrap;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.cpq-hint{margin:0;font-size:12px;color:#b45309}
.cpq-doc .cpx-row-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cpq-doc .cpx-row-btns .cp-btn{white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
@media(max-width:420px){.cpq-lines th:nth-child(3),.cpq-lines td:nth-child(3){display:none}.cpq-lines th:first-child,.cpq-lines td:first-child{width:56%}}
`
