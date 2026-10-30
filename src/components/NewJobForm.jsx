import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { geocodeAddress } from '../lib/geocode'
import { isNavigableAddress } from '../lib/mapsLink'
import {
  DEEP_TASKS, deepTaskName, cleanCustomTask, buildDeepTaskTitle, deepTasksFromTitle,
  applyCleaningTypeToTitle, getCleaningType, locationNameFromTitle, cleaningTypesForLang,
} from '../lib/cleaningType'
import { checklistTemplateForJob, parseChecklistTemplate, checklistDisplayLabel, resolveChecklistLocationName, LOCATION_CHECKLISTS } from '../lib/jobChecklist'
import { useLang, pickLang, localeOf } from '../hooks/useLang'
import ClientContactField from './ClientContactField'
import { fillClientContact } from '../lib/clientContact'
import { tokyoToday } from '../lib/dates'
import { emptySpotContractForm, buildSpotContractRow, contractPrefillFromClient } from '../lib/spotContract'
import { saveSpotContractWithInvoice } from '../lib/spotContractOps'
import { notifyCreated } from '../lib/assignOps'
import SellerCommissionFields from './SellerCommissionFields'
import { splitChecklist } from '../lib/agenda'
import { contractForPlace } from '../lib/places'
import './new-job.css'

const EMPTY = {
  title: '', client_id: '', employee_id: '', scheduled_date: '', scheduled_time: '',
  address: '', gps_lat: '', gps_lng: '', value: 0, description: '', checklist_template: '',
  photo_required: false, location_id: '', job_category: 'regular', spot_value: 0, cleaning_type: 'basic',
  deep_tasks: [], custom_tasks: [],
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const sameLoc = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Admin "New job" form: tap a place, what, who and when — the rest is filled from the
 * last job at that place. Deep cleaning asks which tasks, and they become the employee's checklist.
 */
export default function NewJobForm({ jobs = [], employees = [], clients = [], locations = [], sellers, onCreated }) {
  // `locations` = single place list (lib/places.js): saved places + stores that only exist in Contracts.
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const TYPES = cleaningTypesForLang(lang)
  const [form, setForm] = useState(EMPTY)
  const [contractForm, setContractForm] = useState(emptySpotContractForm)
  const [query, setQuery] = useState('')
  const [otherPlace, setOtherPlace] = useState(false)
  const [valueTouched, setValueTouched] = useState(false)
  const [checklistEdited, setChecklistEdited] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [taskDraft, setTaskDraft] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const updContract = (k, v) => setContractForm(f => ({ ...f, [k]: v }))
  const isSpot = form.job_category === 'spot'
  const isDeep = form.cleaning_type === 'deep'
  const today = tokyoToday()

  // Jobs per place (newest first), used for prefill, sorting and the "last time" hints.
  const jobsByPlace = useMemo(() => {
    const map = new Map()
    for (const j of jobs) {
      if (j.status === 'cancelled') continue
      const key = locationNameFromTitle(j.title).toLowerCase()
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(j)
    }
    for (const list of map.values()) list.sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)))
    return map
  }, [jobs])
  const jobsAt = name => jobsByPlace.get(String(name || '').trim().toLowerCase()) || []

  const sortedLocations = useMemo(() => {
    const since = addDays(today, -60)
    const recent = l => jobsAt(l.name).filter(j => j.scheduled_date >= since).length
    return [...locations].sort((a, b) => recent(b) - recent(a) || a.name.localeCompare(b.name))
  }, [locations, jobsByPlace, today])
  const q = query.trim().toLowerCase()
  const shownLocations = q
    ? sortedLocations.filter(l => `${l.name} ${l.address || ''}`.toLowerCase().includes(q))
    : sortedLocations.slice(0, 12)
  const selectedLoc = locations.find(l => l.id === form.location_id)
  const placeName = selectedLoc?.name || form.title
  const pastHere = jobsAt(placeName)
  const lastOfType = type => pastHere.find(j => getCleaningType(j) === type)
  const lastDeep = lastOfType('deep')
  const lastDeepTasks = lastDeep ? deepTasksFromTitle(lastDeep.title) : null

  const pickLocation = (loc) => {
    const past = jobsAt(loc.name)
    const last = past[0]
    const sameType = past.find(j => getCleaningType(j) === form.cleaning_type)
    const contract = contractForPlace(loc, form.cleaning_type)
    setOtherPlace(false)
    setQuery('')
    setForm(f => ({
      ...f,
      location_id: loc.id,
      title: loc.name,
      address: loc.address || '',
      gps_lat: loc.gps_lat || '',
      gps_lng: loc.gps_lng || '',
      description: loc.notes || '',
      client_id: loc.client_id || contract?.client_id || last?.client_id || f.client_id,
      employee_id: f.employee_id || last?.employee_id || '',
      scheduled_time: f.scheduled_time || (last?.scheduled_time || '').slice(0, 5),
      // Value comes from the place's contract; the last job here is only a fallback.
      value: valueTouched ? f.value : Number(contract?.price_per_visit || sameType?.value || last?.value || f.value) || 0,
    }))
    const cli = clients.find(c => c.id === (loc.client_id || contract?.client_id || last?.client_id))
    if (cli) setContractForm(f => ({ ...f, ...contractPrefillFromClient(cli) }))
  }

  const clearLocation = () => {
    setForm(f => ({ ...f, location_id: '', title: '', address: '', gps_lat: '', gps_lng: '', description: '' }))
  }

  const setType = (type) => {
    const sameType = lastOfType(type)
    const contract = selectedLoc ? contractForPlace(selectedLoc, type) : null
    const fromContract = Number(contract?.price_per_visit) || 0
    setForm(f => ({
      ...f,
      cleaning_type: type,
      value: valueTouched ? f.value : fromContract || (sameType ? Number(sameType.value) || 0 : f.value),
    }))
  }

  const toggleTask = id => setForm(f => ({
    ...f,
    deep_tasks: f.deep_tasks.includes(id) ? f.deep_tasks.filter(x => x !== id) : [...f.deep_tasks, id],
  }))
  // Several lines pasted at once become several tasks (they used to be glued into one line).
  const addCustomTask = () => {
    const list = splitChecklist(taskDraft).map(cleanCustomTask).filter(Boolean)
    if (!list.length) return
    setForm(f => ({ ...f, custom_tasks: [...f.custom_tasks, ...list.filter(t => !f.custom_tasks.includes(t))] }))
    setTaskDraft('')
  }
  const removeCustomTask = t => setForm(f => ({ ...f, custom_tasks: f.custom_tasks.filter(x => x !== t) }))
  const repeatLastDeep = () => {
    if (!lastDeepTasks) return
    setForm(f => ({ ...f, deep_tasks: lastDeepTasks.ids, custom_tasks: lastDeepTasks.custom }))
  }

  const employeeOrder = useMemo(() => {
    const count = new Map()
    for (const j of pastHere.slice(0, 30)) count.set(j.employee_id, (count.get(j.employee_id) || 0) + 1)
    return [...employees].sort((a, b) => (count.get(b.id) || 0) - (count.get(a.id) || 0) || a.full_name.localeCompare(b.full_name))
  }, [employees, pastHere])

  const finalTitle = (() => {
    const base = (form.title || '').trim()
    if (!base) return ''
    if (base.includes(' — ')) return base
    return isDeep ? buildDeepTaskTitle(base, form.deep_tasks, form.custom_tasks) : applyCleaningTypeToTitle(base, 'basic')
  })()
  const isCatalogPlace = !!LOCATION_CHECKLISTS[resolveChecklistLocationName(form.title)]
  const placeContract = selectedLoc ? contractForPlace(selectedLoc, form.cleaning_type) : null
  const contractChecklist = splitChecklist(selectedLoc?.checklist || placeContract?.training_checklist).join('\n')
  const autoChecklist = finalTitle ? (checklistTemplateForJob({ title: finalTitle }) || contractChecklist) : ''
  const checklistText = checklistEdited ? form.checklist_template : autoChecklist
  const employeeSees = finalTitle ? parseChecklistTemplate(checklistTemplateForJob({ title: finalTitle, checklist_template: checklistText })) : []

  const handleGeocode = async () => {
    if (!form.address) return toast.error(L('Type the address first', '先に住所を入力', 'Digite o endereço primeiro'))
    setGeocoding(true)
    const result = await geocodeAddress(form.address)
    setGeocoding(false)
    if (result?.lat && result?.lng) {
      setForm(f => ({ ...f, gps_lat: result.lat, gps_lng: result.lng }))
    } else if (!result?.mapsLink && !isNavigableAddress(form.address)) {
      toast.error(L('Address not found', '住所が見つかりません', 'Endereço não encontrado'))
    }
  }

  const missing = [
    !form.title && L('place', '場所', 'local'),
    !form.employee_id && L('employee', '担当者', 'funcionário'),
    !form.scheduled_date && L('date', '日付', 'data'),
    form.title && !form.address && L('address', '住所', 'endereço'),
  ].filter(Boolean)

  const create = async (another) => {
    if (missing.length || (isDeep && !form.deep_tasks.length && !form.custom_tasks.length)) {
      // The error shows on the field itself; the page scrolls to the first one.
      setShowErrors(true)
      setTimeout(() => document.querySelector('.nj-field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30)
      return
    }
    setSaving(true)
    const emp = employees.find(e => e.id === form.employee_id)
    const cli = clients.find(c => c.id === form.client_id)
    const { data: inserted, error } = await supabase.from('jobs').insert({
      title: finalTitle,
      client_id: form.client_id || null,
      client_name: cli?.company_name || '',
      employee_id: form.employee_id,
      employee_name: emp?.full_name || '',
      scheduled_date: form.scheduled_date,
      scheduled_time: form.scheduled_time,
      address: form.address,
      gps_lat: form.gps_lat || null,
      gps_lng: form.gps_lng || null,
      value: parseFloat(form.value) || 0,
      spot_value: parseFloat(form.spot_value) || 0,
      description: form.description,
      checklist_template: splitChecklist(checklistText).join('\n') || null,
      photo_required: form.photo_required,
      job_category: form.job_category,
      status: 'assigned',
      spot_status: isSpot ? 'pending' : null,
    }).select().single()
    if (error) { setSaving(false); return toast.error(error.message) }
    if (!isSpot) notifyCreated([inserted]).catch(() => {})
    toast.success(isSpot
      ? L('Spot job sent! Waiting for the employee to accept.', 'スポット送信！担当者の承認待ち', 'Spot enviado! Esperando o funcionário aceitar.')
      : L('Job created!', '作成しました！', 'Serviço criado!'))
    if (isSpot && contractForm.enabled) {
      const row = buildSpotContractRow({ contract: contractForm, job: inserted, form: { ...form, title: finalTitle }, location: selectedLoc, client: cli, employee: emp })
      try {
        const { contract: saved, invoice, invoiceError } = await saveSpotContractWithInvoice(row)
        if (cli) fillClientContact(supabase, cli, contractForm).catch(() => {})
        toast.success(`📄 Contract ${saved.contract_number} saved in Contracts → Spot`)
        if (invoice) toast.success(`💴 Invoice created · payment due ${invoice.due_date}`)
        if (invoiceError) toast.error(`Invoice not created: ${invoiceError.message}`)
      } catch (cErr) {
        toast.error(`Contract not saved: ${cErr.message}`)
      }
    }
    setSaving(false)
    setContractForm(emptySpotContractForm())
    setValueTouched(false)
    setChecklistEdited(false)
    setShowErrors(false)
    setOtherPlace(false)
    // "Create and add another" keeps who / when / type so a day can be filled place by place.
    setForm(another
      ? { ...EMPTY, employee_id: form.employee_id, scheduled_date: form.scheduled_date, scheduled_time: form.scheduled_time, cleaning_type: form.cleaning_type, job_category: form.job_category }
      : EMPTY)
    onCreated?.({ another })
  }

  const dateChips = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i)
    const label = i === 0 ? L('Today', '今日', 'Hoje') : i === 1 ? L('Tomorrow', '明日', 'Amanhã')
      : new Date(`${d}T12:00:00`).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric' })
    return { d, label }
  })
  const lastTime = (pastHere[0]?.scheduled_time || '').slice(0, 5)
  const valueKey = isSpot ? 'spot_value' : 'value'
  const lastValue = lastOfType(form.cleaning_type)?.value
  const taskNames = [
    ...DEEP_TASKS.filter(t => form.deep_tasks.includes(t.id)).map(t => deepTaskName(t, lang)),
    ...form.custom_tasks,
  ]
  const fmtDate = d => new Date(`${d}T12:00:00`).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="nj">
      {/* 1 — where */}
      <section className="nj-step">
        <div className="nj-step-head"><span className="nj-num">1</span>{L('Where?', 'どこ？', 'Onde?')}</div>
        {showErrors && !form.title && <div className="nj-field-error">⚠️ {L('Pick the place', '場所を選んでください', 'Escolha o local')}</div>}
        {showErrors && form.title && !form.address && <div className="nj-field-error">⚠️ {L('Type the address or a Google Maps link', '住所かGoogleマップのリンクを入力', 'Digite o endereço ou um link do Google Maps')}</div>}
        {form.title && !otherPlace ? (
          <div className="nj-picked">
            <div className="nj-picked-main">
              <div className="nj-picked-name">📍 {form.title}</div>
              <div className="nj-picked-sub">
                {form.address ? (form.address.startsWith('http') ? '🗺 Google Maps' : form.address) : L('No address', '住所なし', 'Sem endereço')}
                {form.gps_lat ? ' · GPS ✓' : ''}
              </div>
              {pastHere[0] && (
                <div className="nj-picked-hint">
                  {L('Filled from the last job here', '前回の内容を入力済み', 'Preenchido com o último serviço daqui')} ({fmtDate(pastHere[0].scheduled_date)})
                </div>
              )}
            </div>
            <button type="button" className="btn btn-sm" onClick={clearLocation}>{L('Change', '変更', 'Trocar')}</button>
          </div>
        ) : otherPlace ? (
          <div className="nj-other">
            <div className="form-group">
              <label>{L('Place name', '場所の名前', 'Nome do local')} *</label>
              <input value={form.title} onChange={e => upd('title', e.target.value)} placeholder={L('e.g. Hotel Shibuya', '例：渋谷ホテル', 'ex.: Hotel Shibuya')} autoFocus />
            </div>
            <div className="form-group">
              <label>{L('Address or Google Maps link', '住所またはGoogleマップのリンク', 'Endereço ou link do Google Maps')} *</label>
              <div className="nj-row">
                <input value={form.address} onChange={e => upd('address', e.target.value)} placeholder="東京都新宿区…" />
                <button type="button" className="btn" onClick={handleGeocode} disabled={geocoding}>{geocoding ? '…' : '📍 GPS'}</button>
              </div>
              {form.gps_lat && <div className="nj-ok">✓ GPS {Number(form.gps_lat).toFixed(4)}, {Number(form.gps_lng).toFixed(4)}</div>}
            </div>
            <button type="button" className="nj-link" onClick={() => { setOtherPlace(false); clearLocation() }}>← {L('Back to saved places', '保存した場所に戻る', 'Voltar aos locais salvos')}</button>
          </div>
        ) : (
          <>
            <input className="nj-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`🔎 ${L('Search place…', '場所を検索…', 'Buscar local…')}`} />
            <div className="nj-chips">
              {shownLocations.map(l => (
                <button key={l.id} type="button" className="nj-chip nj-place" onClick={() => pickLocation(l)}>
                  {l.name}
                </button>
              ))}
              <button type="button" className="nj-chip nj-chip-ghost" onClick={() => { setOtherPlace(true); clearLocation() }}>
                + {L('Other place', 'その他の場所', 'Outro lugar')}
              </button>
            </div>
            {q && !shownLocations.length && <div className="nj-muted">{L('No saved place found.', '見つかりません。', 'Nenhum local salvo encontrado.')}</div>}
          </>
        )}
      </section>

      {/* 2 — what */}
      <section className="nj-step">
        <div className="nj-step-head"><span className="nj-num">2</span>{L('What?', '何を？', 'O quê?')}</div>
        <div className="nj-seg">
          {['basic', 'deep'].map(type => (
            <button key={type} type="button" className={`nj-seg-btn${form.cleaning_type === type ? ` on ${type}` : ''}`} onClick={() => setType(type)}>
              {type === 'basic' ? '🧹' : '✨'} {TYPES[type].label}
            </button>
          ))}
        </div>

        {isDeep && (
          <div className="nj-deep">
            {showErrors && !form.deep_tasks.length && !form.custom_tasks.length && <div className="nj-field-error">⚠️ {L('Pick what must be done in the deep clean', 'ディープ清掃の作業を選んでください', 'Escolha o que deve ser feito na limpeza pesada')}</div>}
            <div className="nj-deep-head">
              <b>{L('What must be done?', '何をしますか？', 'O que deve ser feito?')}</b>
              <span>{L('Tap all that apply', '該当するものをすべてタップ', 'Toque em tudo que vale')}</span>
            </div>
            {lastDeepTasks && (lastDeepTasks.ids.length + lastDeepTasks.custom.length) > 0 && (
              <button type="button" className="nj-repeat" onClick={repeatLastDeep}>
                ↺ {L('Same as last time', '前回と同じ', 'Igual à última vez')} ({fmtDate(lastDeep.scheduled_date)}):{' '}
                {[...DEEP_TASKS.filter(t => lastDeepTasks.ids.includes(t.id)).map(t => deepTaskName(t, lang)), ...lastDeepTasks.custom].join(', ')}
              </button>
            )}
            <div className="nj-tasks">
              {DEEP_TASKS.map(t => {
                const on = form.deep_tasks.includes(t.id)
                return (
                  <button key={t.id} type="button" className={`nj-task${on ? ' on' : ''}`} onClick={() => toggleTask(t.id)} aria-pressed={on}>
                    <span className="nj-task-icon">{on ? '✓' : t.icon}</span>
                    <span>{deepTaskName(t, lang)}</span>
                  </button>
                )
              })}
            </div>
            {form.custom_tasks.length > 0 && (
              <div className="nj-chips" style={{ marginTop: 8 }}>
                {form.custom_tasks.map(t => (
                  <span key={t} className="nj-chip on">✓ {t} <button type="button" onClick={() => removeCustomTask(t)} aria-label="remove">×</button></span>
                ))}
              </div>
            )}
            <div className="nj-row" style={{ marginTop: 8 }}>
              <input value={taskDraft} onChange={e => setTaskDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTask() } }}
                placeholder={L('Something else? e.g. clean behind the fridge', 'その他？ 例：冷蔵庫の裏', 'Outra coisa? ex.: limpar atrás da geladeira')} />
              <button type="button" className="btn" onClick={addCustomTask} disabled={!taskDraft.trim()}>+ {L('Add', '追加', 'Adicionar')}</button>
            </div>
          </div>
        )}

        <div className="nj-seg nj-seg-small">
          <button type="button" className={`nj-seg-btn${!isSpot ? ' on' : ''}`} onClick={() => upd('job_category', 'regular')}>📋 {L('Normal job', '通常', 'Serviço normal')}</button>
          <button type="button" className={`nj-seg-btn${isSpot ? ' on spot' : ''}`} onClick={() => upd('job_category', 'spot')}>⚡ {L('Spot (employee accepts)', 'スポット（承認制）', 'Spot (funcionário aceita)')}</button>
        </div>
      </section>

      {/* 3 — who */}
      <section className="nj-step">
        <div className="nj-step-head"><span className="nj-num">3</span>{L('Who?', '誰が？', 'Quem?')}</div>
        {showErrors && !form.employee_id && <div className="nj-field-error">⚠️ {L('Pick who does it', '担当者を選んでください', 'Escolha quem faz')}</div>}
        <div className="nj-chips">
          {employeeOrder.map(e => (
            <button key={e.id} type="button" className={`nj-chip${form.employee_id === e.id ? ' on' : ''}`} onClick={() => upd('employee_id', e.id)}>
              {form.employee_id === e.id ? '✓ ' : ''}{e.full_name}
            </button>
          ))}
        </div>
      </section>

      {/* 4 — when */}
      <section className="nj-step">
        <div className="nj-step-head"><span className="nj-num">4</span>{L('When?', 'いつ？', 'Quando?')}</div>
        {showErrors && !form.scheduled_date && <div className="nj-field-error">⚠️ {L('Pick the date', '日付を選んでください', 'Escolha a data')}</div>}
        <div className="nj-chips">
          {dateChips.map(c => (
            <button key={c.d} type="button" className={`nj-chip${form.scheduled_date === c.d ? ' on' : ''}`} onClick={() => upd('scheduled_date', c.d)}>{c.label}</button>
          ))}
        </div>
        <div className="nj-when">
          <label>{L('Date', '日付', 'Data')}<input type="date" value={form.scheduled_date} onChange={e => upd('scheduled_date', e.target.value)} /></label>
          <label>{L('Time', '時間', 'Horário')}<input type="time" value={form.scheduled_time} onChange={e => upd('scheduled_time', e.target.value)} /></label>
          {lastTime && lastTime !== form.scheduled_time && (
            <button type="button" className="nj-chip" onClick={() => upd('scheduled_time', lastTime)}>🕐 {lastTime} <small>{L('last time', '前回', 'última vez')}</small></button>
          )}
        </div>
      </section>

      {/* 5 — price and client */}
      <section className="nj-step">
        <div className="nj-step-head"><span className="nj-num">5</span>{L('Price and client', '金額と顧客', 'Valor e cliente')}</div>
        <div className="nj-when">
          <label>
            {isSpot ? L('⚡ Spot value (¥) — added to salary', '⚡ スポット額（¥）', '⚡ Valor do spot (¥) — vai pro salário') : L('Job value (¥)', '金額（¥）', 'Valor (¥)')}
            <input type="number" inputMode="numeric" value={form[valueKey]} onChange={e => { setValueTouched(true); upd(valueKey, e.target.value) }} />
            {!isSpot && placeContract?.price_per_visit > 0 && <small className="nj-muted">📄 {L('From the contract', '契約から', 'Do contrato')}: ¥{Number(placeContract.price_per_visit).toLocaleString()}</small>}
            {!isSpot && !placeContract && lastValue != null && Number(lastValue) !== Number(form.value) && (
              <button type="button" className="nj-link" onClick={() => upd('value', Number(lastValue) || 0)}>
                {L('Last time', '前回', 'Última vez')}: ¥{Number(lastValue).toLocaleString()}
              </button>
            )}
          </label>
          <label>
            {L('Client', '顧客', 'Cliente')}
            <select value={form.client_id} onChange={e => { upd('client_id', e.target.value); setContractForm(f => ({ ...f, ...contractPrefillFromClient(clients.find(c => c.id === e.target.value)) })) }}>
              <option value="">—</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* more options */}
      <section className="nj-step nj-more">
        <button type="button" className="nj-more-toggle" onClick={() => setShowMore(v => !v)} aria-expanded={showMore}>
          {showMore ? '▾' : '▸'} {L('More options', 'その他の設定', 'Mais opções')}
          <span>{L('notes, checklist, photo', 'メモ・チェックリスト・写真', 'instruções, checklist, foto')}{isSpot ? L(', contract', '・契約', ', contrato') : ''}</span>
        </button>
        {showMore && (
          <div className="nj-more-body">
            <div className="form-group">
              <label>{L('Instructions for the employee', '担当者への指示', 'Instruções para o funcionário')}</label>
              <textarea value={form.description} onChange={e => upd('description', e.target.value)} rows={2} placeholder={L('Key box, parking…', 'キーボックス、駐車場…', 'Keybox, estacionamento…')} />
            </div>
            {!isCatalogPlace && (
              <div className="form-group">
                <label>{L('Checklist (one item per line)', 'チェックリスト（1行1項目）', 'Checklist (um item por linha)')}</label>
                <textarea value={checklistText} onChange={e => { setChecklistEdited(true); upd('checklist_template', e.target.value) }} rows={4} placeholder={L('Clean floors\nWipe windows', '床清掃\n窓拭き', 'Limpar piso\nLimpar vidros')} />
              </div>
            )}
            <label className="nj-check">
              <input type="checkbox" checked={form.photo_required} onChange={e => upd('photo_required', e.target.checked)} />
              📷 {L('Photo required to finish', '完了に写真が必要', 'Foto obrigatória para finalizar')}
            </label>
            {isSpot && (
              <div className="card" style={{ border: '1px solid #EF9F27', margin: '12px 0 0', padding: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: contractForm.enabled ? 12 : 0 }}>
                  <input type="checkbox" checked={contractForm.enabled} onChange={e => updContract('enabled', e.target.checked)} style={{ width: 16, height: 16 }} />
                  📄 {L('Create a contract with this place', 'この場所と契約書を作成', 'Criar contrato com este local')}
                </label>
                {contractForm.enabled && (<>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>業務委託契約書 · company data of the location (甲) is filled from the client; KuriPuro (乙) data is added automatically.</div>
                  <div className="grid-2">
                    <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Company address (甲)</label><input value={contractForm.client_address} onChange={e => updContract('client_address', e.target.value)} placeholder="東京都港区…" /></div>
                    <div className="form-group"><label>Representative (代表者)</label><input value={contractForm.client_representative} onChange={e => updContract('client_representative', e.target.value)} placeholder="代表取締役 山田 太郎" /></div>
                    <div className="form-group"><label>Payment day (next month)</label><input type="number" min="1" max="31" value={contractForm.payment_day} onChange={e => updContract('payment_day', e.target.value)} /></div>
                    <ClientContactField client={clients.find(c => c.id === form.client_id)} lang={lang} name={contractForm.contact_name} phone={contractForm.contact_phone} onName={v => updContract('contact_name', v)} onPhone={v => updContract('contact_phone', v)} />
                    <div className="form-group"><label>Price charged to the location (¥)</label><input type="number" value={contractForm.price} onChange={e => updContract('price', e.target.value)} placeholder="30000" /></div>
                    <div className="form-group"><label>Tax</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select value={contractForm.tax_rate} onChange={e => updContract('tax_rate', e.target.value)}><option value="10">10%</option><option value="8">8%</option><option value="0">0%</option></select>
                        <select value={String(contractForm.price_includes_tax)} onChange={e => updContract('price_includes_tax', e.target.value === 'true')}><option value="true">incl. tax</option><option value="false">+ tax</option></select>
                      </div>
                    </div>
                    <SellerCommissionFields sellers={sellers?.salespeople || []} rules={sellers?.rules || []} contract={{ ...contractForm, price: contractForm.price || form.value }} value={contractForm} onChange={patch => setContractForm(f => ({ ...f, ...patch }))} />
                  </div>
                  <div className="form-group"><label>Scope of work (empty = checklist)</label><textarea value={contractForm.scope} onChange={e => updContract('scope', e.target.value)} rows={3} placeholder="Kitchen floor, range hood, grease trap..." /></div>
                  <div className="form-group"><label>Special terms 特記事項 (optional)</label><textarea value={contractForm.terms} onChange={e => updContract('terms', e.target.value)} rows={3} placeholder="例：駐車場は店舗裏を使用可" /></div>
                </>)}
              </div>
            )}
          </div>
        )}
      </section>

      {employeeSees.length > 0 && (
        <details className="nj-preview">
          <summary>✅ {L('The employee will tick', '担当者のチェック項目', 'O funcionário vai marcar')} ({employeeSees.length})</summary>
          <ul>{employeeSees.map(c => <li key={c}>{checklistDisplayLabel(c, lang)}</li>)}</ul>
        </details>
      )}

      {/* summary + create */}
      <div className="nj-footer">
        <div className="nj-summary">
          {form.title
            ? <>
                <b>{form.title}</b> · {isDeep ? `✨ ${TYPES.deep.short}${taskNames.length ? ` (${taskNames.join(', ')})` : ''}` : `🧹 ${TYPES.basic.short}`}
                {form.employee_id && <> · 👤 {employees.find(e => e.id === form.employee_id)?.full_name}</>}
                {form.scheduled_date && <> · 📅 {fmtDate(form.scheduled_date)}{form.scheduled_time ? ` ${form.scheduled_time}` : ''}</>}
                {' · '}¥{Number(form[valueKey] || 0).toLocaleString()}
              </>
            : <span className="nj-muted">{L('Pick a place to start', '場所を選んでください', 'Escolha um local para começar')}</span>}
          {missing.length > 0 && form.title && <div className="nj-missing">{L('Missing', '未入力', 'Falta')}: {missing.join(', ')}</div>}
        </div>
        <div className="nj-actions">
          <button type="button" className="btn" disabled={saving} onClick={() => create(true)}>
            {L('Create + another', '作成して次へ', 'Criar e fazer outro')}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => create(false)}>
            {saving ? '…' : isSpot ? `⚡ ${L('Send spot', 'スポット送信', 'Enviar spot')}` : `✅ ${L('Create job', '作成', 'Criar serviço')}`}
          </button>
        </div>
      </div>
    </div>
  )
}
