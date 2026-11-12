// v1.0.211 · Images attached to a 見積書. Admin: add / remove. Client portal: view (tap = full size).
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { pickLang } from '../hooks/useLang'
import { askConfirm } from './ConfirmDialog'
import { deleteQuoteAttachment, listQuoteAttachments, uploadQuoteAttachment } from '../lib/quoteFiles'

export default function QuoteAttachments({ quoteId, lang, editable = false, onCount, files: given }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [files, setFiles] = useState(given || null)
  const [busy, setBusy] = useState('')
  const [big, setBig] = useState(null)
  const input = useRef(null)
  const reload = () => listQuoteAttachments(quoteId).then(f => { setFiles(f); onCount?.(f.length) })
  useEffect(() => { if (given) setFiles(given); else if (quoteId) reload() }, [quoteId, given]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async list => {
    const arr = [...(list || [])]
    if (!arr.length) return
    try {
      for (const [i, f] of arr.entries()) { setBusy(`${i + 1}/${arr.length}`); await uploadQuoteAttachment(quoteId, f) }
      toast.success(L('Image attached — the client sees it with the quote.', '画像を添付しました（お客様は見積書と一緒に見られます）。', 'Imagem anexada — o cliente vê junto do orçamento.'))
    } catch (e) { toast.error(String(e.message || e).slice(0, 160)) } finally { setBusy(''); if (input.current) input.current.value = ''; reload() }
  }
  const remove = async f => {
    if (!await askConfirm({ title: L('Remove this image?', 'この画像を削除しますか？', 'Remover esta imagem?'), confirmLabel: L('Remove', '削除', 'Remover'), danger: true })) return
    try { await deleteQuoteAttachment(f.path); reload() } catch (e) { toast.error(e.message) }
  }

  if (!editable && !(files || []).length) return null
  return (
    <div className="qa-box">
      <style>{QA_CSS}</style>
      <div className="qa-head">
        <strong>🖼 {L('Attached images', '添付画像', 'Imagens anexadas')}{files?.length ? ` · ${files.length}` : ''}</strong>
        {editable && (
          <>
            <button type="button" className="btn btn-sm" disabled={!quoteId || !!busy} onClick={() => input.current?.click()}>
              {busy ? `${L('Sending', '送信中', 'Enviando')} ${busy}…` : `＋ ${L('Attach image', '画像を添付', 'Anexar imagem')}`}
            </button>
            <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => add(e.target.files)} />
          </>
        )}
      </div>
      {editable && !quoteId && <p className="qa-hint">{L('Save the quote first, then attach images.', '見積書を保存してから画像を添付してください。', 'Salve o orçamento primeiro e depois anexe as imagens.')}</p>}
      {editable && quoteId && <p className="qa-hint">{L('Shown to the client in the portal (Quotes) together with this quote once it is sent.', '送付後、お客様ポータル（見積もり）でこの見積書と一緒に表示されます。', 'Aparecem para o cliente no portal (Orçamentos), junto deste orçamento, depois de enviado.')}</p>}
      {(files || []).length > 0 && (
        <div className="qa-grid">
          {files.map(f => (
            <div key={f.path} className="qa-item">
              <button type="button" className="qa-thumb" onClick={() => setBig(f)}><img src={f.url} alt="" loading="lazy" /></button>
              {editable && <button type="button" className="qa-del" onClick={() => remove(f)} aria-label={L('Remove', '削除', 'Remover')}>✕</button>}
            </div>
          ))}
        </div>
      )}
      {big && (
        <div className="qa-zoom" role="dialog" onClick={() => setBig(null)}>
          <img src={big.url} alt="" />
          <a href={big.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{L('Open / download', '開く・保存', 'Abrir / baixar')}</a>
        </div>
      )}
    </div>
  )
}

const QA_CSS = `
.qa-box{display:flex;flex-direction:column;gap:8px;margin:10px 0}
.qa-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.qa-hint{margin:0;font-size:12px;color:var(--text3,#64748b)}
.qa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.qa-item{position:relative}
.qa-thumb{all:unset;cursor:zoom-in;display:block;width:100%;aspect-ratio:1/1;border-radius:10px;overflow:hidden;background:#e2e8f0}
.qa-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.qa-del{position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:12px;border:none;background:rgba(15,23,42,.75);color:#fff;font-size:12px;cursor:pointer}
.qa-zoom{position:fixed;inset:0;z-index:10050;background:rgba(2,6,23,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
.qa-zoom img{max-width:100%;max-height:82vh;border-radius:8px;object-fit:contain}
.qa-zoom a{color:#fff;font-size:14px;font-weight:700}
`
