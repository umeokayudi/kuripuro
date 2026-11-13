// v1.0.210 · Proposta visual (提案書) editor — opens from a 見積 (Orçamentos).
// Left: the form (texts, photos, plans with prices, 12-month schedule). Right: the live sheet.
// On the phone the two are tabs ("Editar" / "Ver"). Photos: send / take one, pick from the photos
// of past services, or let the AI make one. The AI can also write the whole sheet from the quote.
// Export: PDF (A4 landscape), PNG, share (LINE / e-mail) and a link for the client.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { companyKey } from '../lib/clientQuotes'
import { supabase } from '../lib/supabase'
import { askConfirm } from './ConfirmDialog'
import { yen } from '../lib/quoteMath'
import { downloadBlob } from '../lib/contractPdf'
import { canShareFiles, shareFiles } from '../lib/reportShare'
import {
  SHEET_W, SHEET_H, COLORS, COLOR_KEYS, ICON_KEYS, iconSvg, sheetLabels,
  blankProposal, loadProposal, saveProposal, uploadProposalPhoto, uploadSharedPdf, proposalAi, draftPayload, applyDraft,
  linesFromItems, planTotals, switchSheetLang, searchJobPhotos, clientPhotos, photoSlots, setSlot, defaultPrompt, photoUrl,
  proposalHtml, proposalCanvas, proposalPdfFile, proposalFileBase,
} from '../lib/proposal'
import './proposal.css'

const csv = s => String(s || '').split(/[,、，]/).map(x => x.trim()).filter(Boolean)
const MAX_STEPS = 4

/* ------------------------------------------------------------ small inputs */

function AiBox({ value, onChange, field, lang, rows = 3, placeholder }) {
  const { tr } = useLang()
  const [busy, setBusy] = useState('')
  const run = async size => {
    if (!String(value || '').trim()) { toast(tr('Write something first.', '先に入力してください。', 'Escreva algo primeiro.')); return }
    setBusy(size)
    try { onChange((await proposalAi('polish', { text: value, field, size, lang })).text) } catch (e) { toast.error(String(e.message || e).slice(0, 160)) } finally { setBusy('') }
  }
  return (
    <div className="pv-ai">
      <textarea rows={rows} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      <div className="pv-ai-bar">
        <button type="button" disabled={!!busy} onClick={() => run('same')}>{busy === 'same' ? '…' : `✨ ${tr('Fix', '校正', 'Corrigir')}`}</button>
        <button type="button" disabled={!!busy} onClick={() => run('short')}>{busy === 'short' ? '…' : tr('Shorter', '短く', 'Mais curto')}</button>
        <button type="button" disabled={!!busy} onClick={() => run('long')}>{busy === 'long' ? '…' : tr('Longer', '詳しく', 'Mais longo')}</button>
      </div>
    </div>
  )
}

function Seg({ value, options, onChange }) {
  return (
    <div className="pv-seg">{options.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>
  )
}

function ColorPick({ value, onChange }) {
  return (
    <div className="pv-colors">{COLOR_KEYS.map(k => (
      <button key={k} type="button" aria-label={k} className={value === k ? 'on' : ''} style={{ background: COLORS[k].main }} onClick={() => onChange(k)} />
    ))}</div>
  )
}

function IconPick({ value, color, onChange }) {
  return (
    <div className="pv-icons">{ICON_KEYS.map(k => (
      <button key={k} type="button" aria-label={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}
        dangerouslySetInnerHTML={{ __html: iconSvg(k, COLORS[color]?.main || '#1f63b4') }} />
    ))}</div>
  )
}

/* ------------------------------------------------------------ photo slot + picker */

function PhotoSlot({ slot, label, onPick, onClear }) {
  const { tr } = useLang()
  return (
    <div className="pv-slot">
      <button type="button" className="pv-slot-img" onClick={() => onPick('upload')} title={label}>
        {slot?.photo ? <img src={photoUrl(slot.photo)} alt="" /> : <span>📷<small>{tr('Photo', '写真', 'Foto')}</small></span>}
      </button>
      <div className="pv-slot-act">
        <button type="button" onClick={() => onPick('upload')} title={tr('Send / take a photo', '写真を送る・撮る', 'Enviar / tirar foto')}>📷</button>
        <button type="button" onClick={() => onPick('library')} title={tr('Search the photos of our services', '過去の作業写真から探す', 'Buscar nas fotos dos serviços')}>🔎</button>
        <button type="button" onClick={() => onPick('ai')} title={tr('Make with AI', 'AIで作成', 'Gerar com IA')}>✨</button>
        {slot?.photo && <button type="button" onClick={onClear} title={tr('Remove', '削除', 'Tirar')}>✕</button>}
      </div>
    </div>
  )
}

function PhotoPicker({ proposal, slotKey, initialTab, clientId, onUse, onClose }) {
  const { tr } = useLang()
  const slot = photoSlots(proposal).find(s => s.key === slotKey)
  const [tab, setTab] = useState(initialTab || 'upload')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(slot?.slot?.search || '')
  const [onlyClient, setOnlyClient] = useState(!!clientId)
  const [found, setFound] = useState(null)
  const [prompt, setPrompt] = useState(slot?.slot?.prompt || defaultPrompt(proposal, slotKey))
  const [style, setStyle] = useState('photo')
  const [made, setMade] = useState('')
  const file = useRef()

  const search = async () => {
    setBusy(true)
    try { setFound(onlyClient && clientId ? await clientPhotos(clientId, query) : await searchJobPhotos(query)) } catch (e) { toast.error(e.message); setFound([]) } finally { setBusy(false) }
  }
  useEffect(() => { if (tab === 'library' && found === null) search() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async f => {
    if (!f) return
    setBusy(true)
    try { onUse(await uploadProposalPhoto(proposal.id, f), {}) } catch (e) { toast.error(String(e.message || e)) } finally { setBusy(false) }
  }

  const generate = async () => {
    setBusy(true); setMade('')
    try {
      const out = await proposalAi('image', { id: proposal.id, prompt, style, aspect: '4:3' })
      if (out.path) setMade(out.path)
      else if (out.data) {
        const blob = await (await fetch(`data:${out.mime};base64,${out.data}`)).blob()
        setMade(await uploadProposalPhoto(proposal.id, new File([blob], 'ai.png', { type: out.mime })))
      }
    } catch (e) { toast.error(String(e.message || e).slice(0, 220), { duration: 7000 }) } finally { setBusy(false) }
  }

  return createPortal(
    <div className="pv-modal-bg" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="pv-modal" role="dialog" aria-modal="true">
        <div className="pv-modal-hd">
          <b>{tr('Photo', '写真', 'Foto')}{slot?.context ? ` · ${slot.context}` : ''}</b>
          <button type="button" className="pv-x" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <Seg value={tab} onChange={setTab} options={[
          ['upload', `📷 ${tr('Send', '送る', 'Enviar')}`],
          ['library', `🔎 ${tr('Our services', '作業写真', 'Fotos dos serviços')}`],
          ['ai', `✨ ${tr('AI', 'AI作成', 'Gerar com IA')}`],
        ]} />
        {tab === 'upload' && (
          <div className="pv-modal-body">
            <p className="pv-hint">{tr('A photo from the phone (camera or gallery) or from the computer.', 'スマホ（カメラ・ギャラリー）またはPCの写真。', 'Uma foto do celular (câmera ou galeria) ou do computador.')}</p>
            <input ref={file} type="file" accept="image/*" hidden onChange={e => upload(e.target.files?.[0])} />
            <button type="button" className="pv-drop" disabled={busy} onClick={() => file.current?.click()}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files?.[0]) }}>
              {busy ? tr('Sending…', '送信中…', 'Enviando…') : <>📷<span>{tr('Choose or drop a photo', '写真を選ぶ／ドロップ', 'Escolher ou arrastar uma foto')}</span></>}
            </button>
          </div>
        )}
        {tab === 'library' && (
          <div className="pv-modal-body">
            <div className="pv-search">
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }} placeholder={tr('e.g. carpet, AC, grease trap', '例：カーペット, エアコン', 'ex.: carpete, ar-condicionado, grease')} />
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={search}>{busy ? '…' : tr('Search', '検索', 'Buscar')}</button>
            </div>
            {clientId && <label className="pv-check"><input type="checkbox" checked={onlyClient} onChange={e => setOnlyClient(e.target.checked)} /> {tr('Only this client', 'この顧客のみ', 'Só deste cliente')}</label>}
            {found && !found.length && <p className="pv-hint">{tr('No photos found. Try other words (the name of the service in the jobs, like "Deep Clean" or "AC").', '写真が見つかりません。別の言葉で検索してください。', 'Nenhuma foto. Tente outras palavras (o nome do serviço nos jobs, como "Deep Clean" ou "AC").')}</p>}
            <div className="pv-lib">{(found || []).map(f => (
              <button key={`${f.job_id}-${f.side}`} type="button" onClick={() => onUse(f.path, { search: query })}>
                <img src={photoUrl(f.path)} alt="" loading="lazy" />
                <span><i className={f.side}>{f.side === 'before' ? tr('before', '前', 'antes') : tr('after', '後', 'depois')}</i>{String(f.title || '').slice(0, 28)} · {String(f.date || '').slice(5)}</span>
              </button>
            ))}</div>
          </div>
        )}
        {tab === 'ai' && (
          <div className="pv-modal-body">
            <p className="pv-hint">{tr('Describe the picture. The AI makes a new image (no text inside). Check it before sending to the client.', '画像の内容を書いてください。AIが新しい画像を作成します（文字なし）。送る前に確認してください。', 'Descreva a imagem (pode ser em português). A IA cria uma imagem nova, sem texto dentro. Confira antes de mandar ao cliente.')}</p>
            <textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} />
            <Seg value={style} onChange={setStyle} options={[['photo', tr('Realistic photo', '写真風', 'Foto realista')], ['illustration', tr('Illustration', 'イラスト', 'Ilustração')]]} />
            <button type="button" className="btn btn-primary" disabled={busy || !prompt.trim()} onClick={generate}>{busy ? tr('Making the image… (up to 30 s)', '作成中…（最大30秒）', 'Gerando a imagem… (até 30 s)') : `✨ ${made ? tr('Make another', 'もう一度', 'Gerar outra') : tr('Make image', '画像を作成', 'Gerar imagem')}`}</button>
            {made && (
              <div className="pv-made">
                <img src={photoUrl(made)} alt="" />
                <button type="button" className="btn btn-primary" onClick={() => onUse(made, { prompt })}>✓ {tr('Use this image', 'この画像を使う', 'Usar esta imagem')}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------ preview */

function Preview({ html }) {
  const box = useRef()
  const [scale, setScale] = useState(0.4)
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el)
      const inner = el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
      setScale(Math.min(1, Math.max(0.1, inner / SHEET_W)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="pv-preview" ref={box}>
      <div className="pv-preview-frame" style={{ height: SHEET_H * scale }}>
        <iframe title="proposal" srcDoc={html} style={{ width: SHEET_W, height: SHEET_H, transform: `scale(${scale})` }} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ editor */

// v1.0.211 · fills the empty photo slots with this client's REAL photos (before/after of its jobs, store plan photos)
function fillWithClientPhotos(p, found) {
  let next = p; let ok = 0
  const used = new Set(photoSlots(p).map(x => x.slot?.photo).filter(Boolean))
  for (const sl of photoSlots(p).filter(x => !x.slot?.photo)) {
    const want = sl.side === 'during' ? 'before' : sl.side
    const pick = found.find(f => f.side === want && !used.has(f.path)) || found.find(f => !used.has(f.path))
    if (!pick) break
    used.add(pick.path); next = setSlot(next, sl.key, { photo: pick.path }); ok++
  }
  return { next, ok }
}

export default function ProposalEditor({ quote, onClose }) {
  const { tr } = useLang()
  const [p, setP] = useState(null)
  const [items, setItems] = useState([])
  const [isNew, setIsNew] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState('')
  const [view, setView] = useState('edit')
  const [picker, setPicker] = useState(null)
  const [hint, setHint] = useState('')
  const [html, setHtml] = useState('')
  const me = (() => { try { return JSON.parse(localStorage.getItem('kp_user') || '{}')?.name || '' } catch { return '' } })()
  // v1.0.211 · the client of this quote (same company name) → its real photos + where the client sees the sheet
  const [client, setClient] = useState(null)
  const clientId = client?.id || quote.client_id || null

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data }, saved, { data: cls }] = await Promise.all([
        supabase.from('mitsumori_items').select('*').eq('mitsumori_id', quote.id),
        loadProposal(quote.id),
        supabase.from('clients').select('id,company_name'),
      ])
      if (!alive) return
      const its = data || []
      setItems(its)
      const owner = (cls || []).find(c => companyKey(c.company_name) === companyKey(quote.company_name)) || null
      setClient(owner)
      if (saved) setP(saved)
      else {
        let fresh = blankProposal(quote, its, { lang: 'ja', by: me })
        // new sheet: the client's real photos go in straight away (placeholders only when it has none)
        const found = owner ? await clientPhotos(owner.id, quote.site_name || '').catch(() => []) : []
        if (!alive) return
        if (found.length) {
          const { next, ok } = fillWithClientPhotos(fresh, found)
          fresh = next
          toast.success(tr(`${ok} real photos of ${owner.company_name} placed.`, `${owner.company_name} の実際の写真を${ok}枚入れました。`, `${ok} fotos reais de ${owner.company_name} colocadas.`))
          setDirty(true)
        }
        setP(fresh); setIsNew(true)
      }
    })()
    return () => { alive = false }
  }, [quote.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // the sheet re-renders a moment after typing stops (the iframe reload is not free)
  useEffect(() => {
    if (!p) return undefined
    const id = setTimeout(() => setHtml(proposalHtml(p)), 250)
    return () => clearTimeout(id)
  }, [p])

  useEffect(() => {
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const L = useMemo(() => sheetLabels(p?.lang), [p?.lang])
  if (!p) {
    return createPortal(<div className="pv-overlay"><div className="pv-sheet"><div className="pv-loading">{tr('Loading…', '読み込み中…', 'Carregando…')}</div></div></div>, document.body)
  }

  const up = patch => { setP(x => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) })); setDirty(true) }
  const upCompare = (side, patch) => up(x => ({ compare: side ? { ...x.compare, [side]: { ...x.compare[side], ...patch } } : { ...x.compare, ...patch } }))
  const upService = (i, patch) => up(x => ({ services: x.services.map((s, k) => (k === i ? { ...s, ...patch } : s)) }))
  const upStep = (si, i, patch) => up(x => ({ services: x.services.map((s, k) => (k !== si ? s : { ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) })) }))
  const upPlan = (i, patch) => up(x => ({ plans: x.plans.map((pl, k) => (k === i ? { ...pl, ...patch } : (patch.recommended ? { ...pl, recommended: false } : pl))) }))
  const upLine = (pi, li, patch) => up(x => ({ plans: x.plans.map((pl, k) => (k !== pi ? pl : { ...pl, lines: pl.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) })) }))
  const upSched = patch => up(x => ({ schedule: { ...x.schedule, ...patch } }))
  const upRow = (ri, patch) => up(x => ({ schedule: { ...x.schedule, rows: x.schedule.rows.map((r, k) => (k === ri ? { ...r, ...patch } : r)) } }))

  const save = async (quiet = false) => {
    setSaving(true)
    try {
      const out = await saveProposal(p, { by: me })
      setP(out); setDirty(false); setIsNew(false)
      if (!quiet) toast.success(tr('Proposal saved', '提案書を保存しました', 'Proposta salva'))
      return out
    } catch (e) { toast.error(String(e.message || e)); return null } finally { setSaving(false) }
  }

  const close = async () => {
    if (dirty && !(await askConfirm({ title: tr('Close without saving?', '保存せずに閉じますか？', 'Fechar sem salvar?'), message: tr('The changes will be lost.', '変更は失われます。', 'As mudanças serão perdidas.'), confirmLabel: tr('Close', '閉じる', 'Fechar'), danger: true }))) return
    onClose?.()
  }

  const aiDraft = async () => {
    if (!isNew && !(await askConfirm({ title: tr('Let the AI rewrite the sheet?', 'AIで書き直しますか？', 'A IA reescreve a proposta?'), message: tr('Texts, plans and schedule are replaced. Photos you chose stay.', '文章・プラン・スケジュールが置き換わります。選んだ写真は残ります。', 'Textos, planos e agenda são trocados. As fotos que você escolheu ficam.'), confirmLabel: tr('Rewrite', '書き直す', 'Reescrever') }))) return
    setBusy('draft')
    try {
      const { draft } = await proposalAi('draft', draftPayload({ ...p, ai_hint: hint }, quote, items))
      up(x => applyDraft(x, draft, items))
      setIsNew(false)
      toast.success(tr('Done. Now add the photos (📷 🔎 ✨) and check the prices.', 'できました。写真（📷 🔎 ✨）と金額を確認してください。', 'Pronto. Agora coloque as fotos (📷 🔎 ✨) e confira os valores.'), { duration: 6000 })
    } catch (e) { toast.error(String(e.message || e).slice(0, 220), { duration: 7000 }) } finally { setBusy('') }
  }

  // fill every empty photo: from our job photos (no cost) or made by the AI (one by one)
  const fillPhotos = async source => {
    const empty = photoSlots(p).filter(s => !s.slot?.photo)
    if (!empty.length) { toast(tr('All photos are filled.', '写真はすべて入っています。', 'Todas as fotos já estão preenchidas.')); return }
    setBusy(source)
    let next = p; let ok = 0
    const used = new Set(photoSlots(p).map(s => s.slot?.photo).filter(Boolean))
    try {
      for (const [n, s] of empty.entries()) {
        setBusy(`${source}:${n + 1}/${empty.length}`)
        try {
          if (source === 'library') {
            const words = s.slot?.search || `${s.context || ''}`
            // v1.0.211 · this client's real photos first; other services' photos only when it has none
            let found = clientId ? await clientPhotos(clientId, words).catch(() => []) : []
            if (!found.length) found = await searchJobPhotos(words)
            const pick = found.find(f => f.side === (s.side === 'during' ? 'before' : s.side) && !used.has(f.path)) || found.find(f => !used.has(f.path))
            if (pick) { used.add(pick.path); next = setSlot(next, s.key, { photo: pick.path }); ok++ }
          } else {
            const out = await proposalAi('image', { id: p.id, prompt: s.slot?.prompt || defaultPrompt(next, s.key), aspect: '4:3' })
            let path = out.path
            if (!path && out.data) {
              const blob = await (await fetch(`data:${out.mime};base64,${out.data}`)).blob()
              path = await uploadProposalPhoto(p.id, new File([blob], 'ai.png', { type: out.mime }))
            }
            if (path) { next = setSlot(next, s.key, { photo: path }); ok++ }
          }
          setP(next); setDirty(true)
        } catch (e) {
          if (source === 'ai') { toast.error(String(e.message || e).slice(0, 200), { duration: 7000 }); break }
        }
      }
      toast.success(tr(`${ok} of ${empty.length} photos filled`, `${empty.length}枚中${ok}枚の写真を入れました`, `${ok} de ${empty.length} fotos preenchidas`))
    } finally { setBusy('') }
  }

  const exportFile = async kind => {
    setBusy(kind)
    try {
      const canvas = await proposalCanvas(p)
      if (kind === 'png') {
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
        downloadBlob(blob, `${proposalFileBase(p)}.png`)
      } else if (kind === 'pdf') {
        const f = await proposalPdfFile(p, canvas)
        downloadBlob(f, f.name)
      } else if (kind === 'share') {
        const pdf = await proposalPdfFile(p, canvas)
        const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9))
        const png = new File([pngBlob], `${proposalFileBase(p)}.jpg`, { type: 'image/jpeg' })
        const files = [png, pdf]
        if (!canShareFiles(files)) { downloadBlob(pdf, pdf.name); toast(tr('PDF saved — attach it to the message.', 'PDFを保存しました。メッセージに添付してください。', 'PDF baixado — anexe na mensagem.')); return }
        const res = await shareFiles(files, { title: p.title, text: `${p.client_name} ${p.honorific || ''}\n${p.title}` })
        if (res === 'blocked') toast(tr('Tap "Send" again.', 'もう一度「送る」を押してください。', 'Toque em "Enviar" de novo.'))
      } else if (kind === 'link') {
        const pdf = await proposalPdfFile(p, canvas)
        const shared = await uploadSharedPdf(p.id, pdf)
        const saved = await saveProposal({ ...p, shared }, { by: me })
        setP(saved); setDirty(false)
        try { await navigator.clipboard.writeText(shared.url); toast.success(tr('Link copied — paste it in LINE / e-mail', 'リンクをコピーしました（LINE・メールに貼り付け）', 'Link copiado — cole no LINE / e-mail')) } catch { toast(shared.url, { duration: 10000 }) }
      }
    } catch (e) { toast.error(tr('Could not make the file: ', 'ファイルを作成できませんでした：', 'Não deu para fazer o arquivo: ') + String(e.message || e).slice(0, 140)) } finally { setBusy('') }
  }

  const monthName = m => L.months(m)
  const totalsA = planTotals(p.plans?.[0], p.tax_rate)
  const working = !!busy

  const form = (
    <div className="pv-form">
      {isNew && (
        <div className="pv-card pv-start">
          <h4>✨ {tr('Let the AI build the sheet from this quote', 'この見積からAIが提案書を作成', 'A IA monta a proposta a partir deste orçamento')}</h4>
          <p className="pv-hint">{tr('It writes the title, intro, the steps of each service, plans A/B (prices come from the quote items) and the year schedule. Then you add or change the photos.', 'タイトル・説明・作業手順・プランA/B（金額は見積の明細から）・年間スケジュールを作成します。その後、写真を追加・変更してください。', 'Ela escreve o título, a introdução, as etapas de cada serviço, os planos A/B (valores vêm dos itens do orçamento) e a agenda do ano. Depois você coloca ou troca as fotos.')}</p>
          <textarea rows={2} value={hint} onChange={e => setHint(e.target.value)} placeholder={tr('Optional: what to stress (e.g. mites in the carpet; plan A deep clean 2x/year + monthly; plan B 1x/year)', '任意：強調したいこと（例：カーペットのダニ対策、プランAは年2回＋毎月、プランBは年1回）', 'Opcional: o que destacar (ex.: ácaros no carpete; plano A deep 2x/ano + mensal; plano B 1x/ano)')} />
          <button type="button" className="btn btn-primary" disabled={working} onClick={aiDraft}>{busy === 'draft' ? tr('The AI is writing… (up to 40 s)', 'AIが作成中…（最大40秒）', 'A IA está escrevendo… (até 40 s)') : `✨ ${tr('Build with AI', 'AIで作成', 'Montar com IA')}`}</button>
        </div>
      )}

      <div className="pv-card">
        <h4>{tr('Top', 'ヘッダー', 'Topo')}</h4>
        <div className="pv-row">
          <span className="pv-lbl">{tr('Language of the sheet', '提案書の言語', 'Idioma da proposta')}</span>
          <Seg value={p.lang} onChange={lang => up(x => switchSheetLang(x, lang))} options={[['ja', '日本語'], ['en', 'English'], ['pt', 'Português']]} />
        </div>
        <div className="pv-grid">
          <label className="pv-wide2">{tr('Client', '宛名', 'Cliente')}<input value={p.client_name} onChange={e => up({ client_name: e.target.value })} /></label>
          <label>{tr('Honorific', '敬称', 'Tratamento')}<input value={p.honorific || ''} onChange={e => up({ honorific: e.target.value })} placeholder="御中 / 様" /></label>
          <label className="pv-wide">{tr('Title', 'タイトル', 'Título')}<input value={p.title} onChange={e => up({ title: e.target.value })} /></label>
        </div>
        {!isNew && (
          <details className="pv-redo">
            <summary>✨ {tr('Rewrite everything with AI', 'AIで全体を書き直す', 'Reescrever tudo com IA')}</summary>
            <textarea rows={2} value={hint} onChange={e => setHint(e.target.value)} placeholder={tr('What to change or stress', '変更・強調したいこと', 'O que mudar ou destacar')} />
            <button type="button" className="btn btn-sm btn-primary" disabled={working} onClick={aiDraft}>{busy === 'draft' ? '…' : tr('Rewrite', '書き直す', 'Reescrever')}</button>
          </details>
        )}
      </div>

      <div className="pv-card">
        <h4>{tr('Intro', '説明文', 'Introdução')}</h4>
        <p className="pv-hint">{tr('Blank line = new paragraph. **text** = blue highlight, ++text++ = green highlight.', '空行で段落。**文字** = 青の強調、++文字++ = 緑の強調。', 'Linha em branco = novo parágrafo. **texto** = destaque azul, ++texto++ = destaque verde.')}</p>
        <AiBox value={p.intro} onChange={v => up({ intro: v })} field="intro" lang={p.lang} rows={5} />
      </div>

      <div className="pv-card">
        <div className="pv-card-hd"><h4>{tr('Before → after', 'ビフォー → アフター', 'Antes → depois')}</h4>
          <label className="pv-check"><input type="checkbox" checked={!!p.compare?.show} onChange={e => upCompare(null, { show: e.target.checked })} /> {tr('Show', '表示', 'Mostrar')}</label></div>
        {p.compare?.show && (
          <>
            <label className="pv-lbl-in">{tr('Box title', '枠のタイトル', 'Título do quadro')}<input value={p.compare.title || ''} onChange={e => upCompare(null, { title: e.target.value })} /></label>
            <div className="pv-pair">
              {['before', 'after'].map(side => (
                <div key={side} className="pv-pair-col">
                  <input value={p.compare[side]?.label || ''} onChange={e => upCompare(side, { label: e.target.value })} placeholder={side === 'before' ? L.before : L.after} />
                  <PhotoSlot slot={p.compare[side]} onPick={tab => setPicker({ key: `compare.${side}`, tab })} onClear={() => upCompare(side, { photo: '' })} />
                  {side === 'before' && <input value={(p.compare.before?.tags || []).join(', ')} onChange={e => upCompare('before', { tags: csv(e.target.value).slice(0, 4) })} placeholder={tr('Labels on the photo, with commas', '写真上のラベル（カンマ区切り）', 'Etiquetas na foto, com vírgula')} />}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="pv-card">
        <h4>{tr('Services and steps', '作業の内容', 'Serviços e etapas')}</h4>
        <label className="pv-lbl-in">{tr('Section title', '見出し', 'Título da seção')}<input value={p.work_title || ''} onChange={e => up({ work_title: e.target.value })} /></label>
        {p.services.map((s, si) => (
          <div key={si} className="pv-sub" style={{ borderLeftColor: COLORS[s.color]?.main }}>
            <div className="pv-grid">
              <label className="pv-wide2">{tr('Service', 'サービス名', 'Serviço')}<input value={s.name} onChange={e => upService(si, { name: e.target.value })} /></label>
              <label>{tr('Frequency badge', '頻度', 'Frequência')}<input value={s.badge || ''} onChange={e => upService(si, { badge: e.target.value })} placeholder="毎月 / 年に1〜2回" /></label>
            </div>
            <AiBox value={s.desc} onChange={v => upService(si, { desc: v })} field="desc" lang={p.lang} rows={2} placeholder={tr('Short description', '短い説明', 'Descrição curta')} />
            <div className="pv-row"><ColorPick value={s.color} onChange={color => upService(si, { color })} /><IconPick value={s.icon} color={s.color} onChange={icon => upService(si, { icon })} /></div>
            <div className="pv-steps">
              {s.steps.map((st, i) => (
                <div key={i} className="pv-step">
                  <PhotoSlot slot={st} onPick={tab => setPicker({ key: `services.${si}.steps.${i}`, tab })} onClear={() => upStep(si, i, { photo: '' })} />
                  <input value={st.title} onChange={e => upStep(si, i, { title: e.target.value })} placeholder={`${i + 1}. ${tr('Step', '手順', 'Etapa')}`} />
                  <input value={st.sub || ''} onChange={e => upStep(si, i, { sub: e.target.value })} placeholder={tr('detail (optional)', '補足（任意）', 'detalhe (opcional)')} />
                  {s.steps.length > 1 && <button type="button" className="pv-del" onClick={() => upService(si, { steps: s.steps.filter((_, j) => j !== i) })}>✕</button>}
                </div>
              ))}
              {s.steps.length < MAX_STEPS && <button type="button" className="pv-add" onClick={() => upService(si, { steps: [...s.steps, { title: '', sub: '', photo: '', prompt: '', search: '' }] })}>＋ {tr('Step', '手順', 'Etapa')}</button>}
            </div>
            {p.services.length > 1 && <button type="button" className="pv-link-red" onClick={() => up(x => ({ services: x.services.filter((_, k) => k !== si) }))}>{tr('Remove this service', 'このサービスを削除', 'Tirar este serviço')}</button>}
          </div>
        ))}
        {p.services.length < 3 && <button type="button" className="pv-add" onClick={() => up(x => ({ services: [...x.services, { name: '', badge: '', desc: '', color: ['blue', 'green', 'orange'][x.services.length], icon: 'vacuum', steps: [0, 1, 2].map(() => ({ title: '', sub: '', photo: '', prompt: '', search: '' })) }] }))}>＋ {tr('Service', 'サービス', 'Serviço')}</button>}
      </div>

      <div className="pv-card">
        <h4>{tr('Plans and prices', 'プランと金額', 'Planos e valores')}</h4>
        <div className="pv-row">
          <span className="pv-lbl">{tr('Tax', '消費税', 'Imposto')}</span>
          <Seg value={String(p.tax_rate)} onChange={v => up({ tax_rate: Number(v) })} options={[['10', '10%'], ['8', '8%'], ['0', '0%']]} />
        </div>
        {p.plans.map((pl, pi) => {
          const t = planTotals(pl, p.tax_rate)
          return (
            <div key={pi} className={`pv-sub${pl.recommended ? ' is-rec' : ''}`}>
              <div className="pv-grid">
                <label>{tr('Name', 'プラン名', 'Nome')}<input value={pl.name} onChange={e => upPlan(pi, { name: e.target.value })} /></label>
                <label className="pv-wide2">{tr('Subtitle', 'サブタイトル', 'Subtítulo')}<input value={pl.subtitle || ''} onChange={e => upPlan(pi, { subtitle: e.target.value })} placeholder="年間プログラム" /></label>
              </div>
              <label className="pv-check"><input type="checkbox" checked={!!pl.recommended} onChange={e => upPlan(pi, { recommended: e.target.checked })} /> 👑 {tr('Recommended', 'おすすめ', 'Recomendado')}</label>
              <label className="pv-lbl-in">{tr('Tags (with commas)', 'タグ（カンマ区切り）', 'Etiquetas (com vírgula)')}<input value={(pl.chips || []).join(', ')} onChange={e => upPlan(pi, { chips: csv(e.target.value).slice(0, 3) })} /></label>
              <label className="pv-lbl-in">{tr('Points (one per line)', 'ポイント（1行に1つ）', 'Pontos (um por linha)')}<textarea rows={3} value={(pl.bullets || []).join('\n')} onChange={e => upPlan(pi, { bullets: e.target.value.split('\n').slice(0, 5) })} /></label>
              <div className="pv-lines">
                <div className="pv-lines-hd"><span>{tr('Item', '項目', 'Item')}</span><span>{tr('Qty', '数量', 'Qtd')}</span><span>{tr('Unit', '単位', 'Un.')}</span><span>{tr('Unit price', '単価', 'Preço un.')}</span><span /></div>
                {(pl.lines || []).map((l, li) => (
                  <div key={li} className="pv-line">
                    <input value={l.label} onChange={e => upLine(pi, li, { label: e.target.value })} />
                    <input type="number" min="0" value={l.qty} onChange={e => upLine(pi, li, { qty: e.target.value })} />
                    <input value={l.unit || ''} onChange={e => upLine(pi, li, { unit: e.target.value })} placeholder={L.times} />
                    <input type="number" min="0" value={l.unit_price} onChange={e => upLine(pi, li, { unit_price: e.target.value })} />
                    <button type="button" className="pv-del" onClick={() => upPlan(pi, { lines: pl.lines.filter((_, j) => j !== li) })}>✕</button>
                  </div>
                ))}
                <div className="pv-row">
                  <button type="button" className="pv-add" onClick={() => upPlan(pi, { lines: [...(pl.lines || []), { label: '', qty: 1, unit_price: 0, unit: '' }] })}>＋ {tr('Line', '行', 'Linha')}</button>
                  {items.length > 0 && <button type="button" className="pv-add" onClick={() => upPlan(pi, { lines: linesFromItems(items) })}>↺ {tr('Copy the quote items', '見積の明細をコピー', 'Copiar itens do orçamento')}</button>}
                </div>
                <div className="pv-tot">{L.subtotal} <b>{yen(t.subtotal)}</b> · {L.total} <b className="big">{yen(t.total)}</b></div>
              </div>
              <div className="pv-grid">
                <label className="pv-check"><input type="checkbox" checked={pl.show_price !== false} onChange={e => upPlan(pi, { show_price: e.target.checked })} /> {tr('Show prices on the sheet', '金額を表示', 'Mostrar valores na folha')}</label>
                <label className="pv-wide2">{tr('Price note', '金額の注記', 'Nota do valor')}<input value={pl.price_note || ''} onChange={e => upPlan(pi, { price_note: e.target.value })} placeholder="※年間契約の場合" /></label>
              </div>
              {p.plans.length > 1 && <button type="button" className="pv-link-red" onClick={() => up(x => ({ plans: x.plans.filter((_, k) => k !== pi) }))}>{tr('Remove this plan', 'このプランを削除', 'Tirar este plano')}</button>}
            </div>
          )
        })}
        {p.plans.length < 3 && <button type="button" className="pv-add" onClick={() => up(x => ({ plans: [...x.plans, { name: `${x.lang === 'ja' ? 'プラン' : x.lang === 'pt' ? 'Plano ' : 'Plan '}${'ABC'[x.plans.length]}`, recommended: false, subtitle: '', chips: [], bullets: [], lines: [], show_price: true, price_note: '' }] }))}>＋ {tr('Plan', 'プラン', 'Plano')}</button>}
      </div>

      <div className="pv-card">
        <div className="pv-card-hd"><h4>{tr('Year schedule', '年間スケジュール', 'Agenda do ano')}</h4>
          <label className="pv-check"><input type="checkbox" checked={!!p.schedule?.show} onChange={e => upSched({ show: e.target.checked, rows: p.schedule.rows?.length ? p.schedule.rows : p.services.map(s => ({ label: s.name, color: s.color, marks: Array(12).fill(false), tags: {} })) })} /> {tr('Show', '表示', 'Mostrar')}</label></div>
        {p.schedule?.show && (
          <>
            <div className="pv-grid">
              <label>{tr('Title', 'タイトル', 'Título')}<input value={p.schedule.title || ''} onChange={e => upSched({ title: e.target.value })} /></label>
              <label>{tr('Note', '注記', 'Nota')}<input value={p.schedule.note || ''} onChange={e => upSched({ note: e.target.value })} placeholder="（プランAの例）" /></label>
              <label>{tr('Starts in', '開始月', 'Começa em')}
                <select value={p.schedule.start_month || 1} onChange={e => upSched({ start_month: Number(e.target.value) })}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1)}</option>)}
                </select>
              </label>
            </div>
            {p.schedule.rows.map((r, ri) => {
              const start = (p.schedule.start_month || 1) - 1
              return (
                <div key={ri} className="pv-sub" style={{ borderLeftColor: COLORS[r.color]?.main }}>
                  <div className="pv-row">
                    <input className="pv-grow" value={r.label} onChange={e => upRow(ri, { label: e.target.value })} placeholder={tr('Row name', '行の名前', 'Nome da linha')} />
                    <ColorPick value={r.color} onChange={color => upRow(ri, { color })} />
                    <button type="button" className="pv-del" onClick={() => upSched({ rows: p.schedule.rows.filter((_, k) => k !== ri) })}>✕</button>
                  </div>
                  <div className="pv-months">{Array.from({ length: 12 }, (_, k) => (start + k) % 12).map(m => (
                    <button key={m} type="button" className={r.marks?.[m] ? 'on' : ''} style={r.marks?.[m] ? { background: COLORS[r.color]?.main } : null}
                      onClick={() => upRow(ri, { marks: r.marks.map((v, j) => (j === m ? !v : v)) })}>{monthName(m + 1)}</button>
                  ))}</div>
                  <div className="pv-row">
                    <button type="button" className="pv-add" onClick={() => upRow(ri, { marks: Array(12).fill(true) })}>{tr('Every month', '毎月', 'Todo mês')}</button>
                    <button type="button" className="pv-add" onClick={() => upRow(ri, { marks: Array(12).fill(false), tags: {} })}>{tr('Clear', 'クリア', 'Limpar')}</button>
                    <input className="pv-grow" value={Object.entries(r.tags || {}).map(([k, v]) => `${Number(k) + 1}:${v}`).join(', ')}
                      onChange={e => { const tags = {}; csv(e.target.value).forEach(pair => { const [m, ...v] = pair.split(':'); const idx = Number(m) - 1; if (idx >= 0 && idx < 12 && v.join(':').trim()) tags[idx] = v.join(':').trim() }); upRow(ri, { tags }) }}
                      placeholder={tr('Labels: 1:first, 7:second', 'ラベル：1:初回, 7:2回目', 'Etiquetas: 1:1ª vez, 7:2ª vez')} />
                  </div>
                </div>
              )
            })}
            {p.schedule.rows.length < 3 && <button type="button" className="pv-add" onClick={() => upSched({ rows: [...p.schedule.rows, { label: '', color: 'green', marks: Array(12).fill(false), tags: {} }] })}>＋ {tr('Row', '行', 'Linha')}</button>}
            <label className="pv-lbl-in">{tr('Legend (one per line)', '凡例（1行に1つ）', 'Legenda (uma por linha)')}<textarea rows={2} value={(p.schedule.legend || []).join('\n')} onChange={e => upSched({ legend: e.target.value.split('\n').slice(0, 3) })} /></label>
          </>
        )}
      </div>

      <div className="pv-card">
        <h4>{tr('Footer', 'フッター', 'Rodapé')}</h4>
        <AiBox value={p.footer?.text} onChange={v => up(x => ({ footer: { ...x.footer, text: v } }))} field="footer" lang={p.lang} rows={2} />
        <label className="pv-check"><input type="checkbox" checked={p.footer?.sign !== false} onChange={e => up(x => ({ footer: { ...x.footer, sign: e.target.checked } }))} /> {tr('Show our name and contact', '社名と連絡先を表示', 'Mostrar nosso nome e contato')}</label>
      </div>
    </div>
  )

  const bulkLabel = b => {
    const [k, prog] = String(b).split(':')
    if (k === 'library') return `🔎 ${prog || ''}`
    if (k === 'ai') return `✨ ${prog || ''}`
    return null
  }

  return createPortal(
    <div className="pv-overlay">
      <div className="pv-sheet">
        <div className="pv-head">
          <button type="button" className="pv-x" onClick={close} aria-label="close">✕</button>
          <div className="pv-head-main">
            <b>🎨 {tr('Visual proposal', '提案書（ビジュアル）', 'Proposta visual')}</b>
            <span>{p.client_name || '—'} · {quote.quote_number || ''} · A {yen(totalsA.total)}{dirty ? ` · ${tr('not saved', '未保存', 'não salvo')}` : ''}</span>
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={saving || working} onClick={() => save()}>{saving ? '…' : `💾 ${tr('Save', '保存', 'Salvar')}`}</button>
        </div>
        <div className="pv-tools">
          <div className="pv-tabs-phone"><Seg value={view} onChange={setView} options={[['edit', `✏️ ${tr('Edit', '編集', 'Editar')}`], ['preview', `👁 ${tr('See', '表示', 'Ver')}`]]} /></div>
          <span className="pv-tools-lbl">{tr('Empty photos:', '空の写真：', 'Fotos vazias:')}</span>
          <button type="button" className="btn btn-sm" disabled={working} onClick={() => fillPhotos('library')}>{bulkLabel(busy)?.startsWith('🔎') ? bulkLabel(busy) : `🔎 ${tr('From our services', '作業写真から', 'Das fotos dos serviços')}`}</button>
          <button type="button" className="btn btn-sm" disabled={working} onClick={() => fillPhotos('ai')}>{bulkLabel(busy)?.startsWith('✨') ? bulkLabel(busy) : `✨ ${tr('Make with AI', 'AIで作成', 'Gerar com IA')}`}</button>
          <span className="pv-tools-sp" />
          <button type="button" className="btn btn-sm" disabled={working} onClick={() => exportFile('pdf')}>{busy === 'pdf' ? '…' : '⬇ PDF'}</button>
          <button type="button" className="btn btn-sm" disabled={working} onClick={() => exportFile('png')}>{busy === 'png' ? '…' : '⬇ PNG'}</button>
          <button type="button" className="btn btn-sm" disabled={working} onClick={() => exportFile('share')}>{busy === 'share' ? '…' : `📤 ${tr('Send', '送る', 'Enviar')}`}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={working} onClick={() => exportFile('link')} title={tr('Makes the PDF, saves it and copies a link for the client', 'PDFを作成・保存し、お客様用リンクをコピー', 'Faz o PDF, guarda e copia um link para o cliente')}>{busy === 'link' ? '…' : `🔗 ${tr('Client link', 'お客様用リンク', 'Link p/ cliente')}`}</button>
        </div>
        <div className="pv-shared">
          📁 {tr(`Saved with quote ${quote.quote_number || ''} (💾 Save).`, `見積書 ${quote.quote_number || ''} と一緒に保存されます（💾 保存）。`, `Fica salva junto do orçamento ${quote.quote_number || ''} (💾 Salvar).`)}{' '}
          {client
            ? <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
                <input type="checkbox" checked={p.client_visible !== false} onChange={e => up({ client_visible: e.target.checked })} />
                {tr(`Show in ${client.company_name}'s portal (Quotes), next to the quote once it is sent`, `${client.company_name} のポータル（見積もり）に、送付済みの見積書と一緒に表示`, `Mostrar no portal de ${client.company_name} (Orçamentos), junto do orçamento enviado`)}
              </label>
            : <span>{tr(`No client named "${quote.company_name}" yet: use 🔗 Client link to send it.`, `「${quote.company_name}」という顧客がまだありません。🔗 お客様用リンクで送ってください。`, `Ainda não há cliente com o nome "${quote.company_name}": envie pelo 🔗 Link p/ cliente.`)}</span>}
        </div>
        {p.shared?.url && <div className="pv-shared">🔗 {tr('Last link sent', '最後に作成したリンク', 'Último link')}: <a href={p.shared.url} target="_blank" rel="noreferrer">{String(p.shared.at || '').slice(0, 16).replace('T', ' ')}</a></div>}
        <div className={`pv-body view-${view}`}>
          {form}
          <Preview html={html} />
        </div>
      </div>
      {picker && (
        <PhotoPicker proposal={p} slotKey={picker.key} initialTab={picker.tab} clientId={clientId}
          onClose={() => setPicker(null)}
          onUse={(path, extra) => { up(x => setSlot(x, picker.key, { photo: path, ...extra })); setPicker(null) }} />
      )}
    </div>,
    document.body,
  )
}
