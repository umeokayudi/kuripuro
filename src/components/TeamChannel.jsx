// v1.0.217 · Canal da Equipe (Fase 1): one conversation for the whole team + cover cards with "Eu pego".
// Same component for the admin page (/team-channel) and the employee portal (tab 'team').
// v1.0.221 · channels by area (Geral, Limpeza, Vendas, Marketing): each person sees only their channels;
// the admin sees all and adds / removes people (👥 Membros). Covers live in Limpeza (Geral if mirrored).
// Also used by the sales and marketing portals (tab 'team').
// Rules: a card shows only store · service · day · time (never money); whoever taps "Eu pego" becomes
// responsible at once (atomic, first wins); nobody is assigned automatically.
// v1.0.224 · private conversations (DM, e.g. an employee with the gerência): `focus` opens one conversation only
// (the employee Chat hub uses it, with a back button); without focus, the DMs I am in show as extra tabs.
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import FaceAvatar from './FaceAvatar'
import { askConfirm } from './ConfirmDialog'
import { fmtDay } from './AvailabilityPlanner'
import { pollWhileVisible } from '../lib/visiblePoll'
import { tokyoToday } from '../lib/dates'
import { jobBrief, MAX_TEXT, CHANNELS, myChannels, inChannel, autoChannels, showsCovers, channelLabel, personKey, isDmKey, dmOther } from '../lib/teamChannel'
import {
  loadMessages, postMessage, deleteMessage, loadCoverState, takeCover, askCover, cancelCover, offerToTeam, CHANNEL_CHANGED,
  loadMembers, loadPeople, saveMember, saveMirror, pushChannel, listMyDms,
} from '../lib/teamChannelOps'
import './team-channel.css'

const POLL_MS = 20_000
const PEOPLE_MS = 5 * 60_000
const chFromUrl = () => { try { const c = new URLSearchParams(window.location.search).get('ch'); return CHANNELS.some(x => x.key === c) || isDmKey(c) ? c : null } catch { return null } }

export default function TeamChannel({ me, lang = 'pt', L = (en, ja, pt) => pt, onChanged, focus = null, onBack = null }) {
  const isAdmin = me?.role === 'admin'
  const [msgs, setMsgs] = useState(null)
  const [state, setState] = useState({ cards: [], unassigned: [], myJobs: [] })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(null)
  const [askOpen, setAskOpen] = useState(false)
  const [askJob, setAskJob] = useState('')
  const [askReason, setAskReason] = useState('')
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [members, setMembers] = useState(null)
  const [people, setPeople] = useState([])
  const [dms, setDms] = useState([])
  const [channel, setChannel] = useState(() => focus || chFromUrl() || (me?.role === 'employee' ? 'limpeza' : me?.role === 'salesperson' ? 'geral' : 'geral'))
  const [showMembers, setShowMembers] = useState(false)
  const peopleAt = useRef(0)
  // the person with role details (job_role / team) once the people list is in
  const meFull = people.find(p => p.role === me?.role && p.id === me?.id) || { ...me, is_active: true }
  const groups = members ? myChannels(meFull, members) : []
  // focus = one conversation only (group or private); otherwise my groups + the private ones I am in
  const visible = !members ? [] : focus ? (inChannel(meFull, focus, members) ? [focus] : []) : [...groups, ...dms.filter(k => !groups.includes(k))]
  const current = visible.includes(channel) ? channel : (visible[0] || null)
  const isDm = isDmKey(current)
  const covers = !!current && !!members && showsCovers(current, members)
  const endRef = useRef(null)
  const lastCount = useRef(0)
  const today = tokyoToday()

  const day = d => (d ? `${d === today ? L('Today', '今日', 'Hoje') + ' · ' : ''}${fmtDay(d, lang, { weekday: 'short', day: '2-digit', month: '2-digit' })}` : '')
  const nameOf = k => {
    if (!isDmKey(k)) return channelLabel(k, lang)
    const o = dmOther(k, me, people)
    return o?.role === 'admin' ? `${o?.name || 'Admin'} · ${L('Office', '事務所', 'Escritório')}` : (o?.name || '—')
  }
  const where = b => [b?.store, b?.service, day(b?.date), b?.time].filter(Boolean).join(' · ')
  const timeOf = iso => new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })

  const reload = useCallback(async () => {
    const needPeople = Date.now() - peopleAt.current > PEOPLE_MS
    const [mem, ppl] = await Promise.all([loadMembers().catch(() => null), needPeople ? loadPeople().catch(() => null) : Promise.resolve(null)])
    if (ppl) { peopleAt.current = Date.now(); setPeople(ppl) }
    const list = ppl || people
    const who = list.find(p => p.role === me?.role && p.id === me?.id) || { ...me, is_active: true }
    const myDms = focus ? [] : await listMyDms(me).catch(() => [])
    if (!focus) setDms(myDms)
    const mine = !mem ? [] : focus ? (inChannel(who, focus, mem) ? [focus] : []) : [...myChannels(who, mem), ...myDms]
    if (mem) setMembers(mem)
    const ch = mine.includes(channel) ? channel : mine[0]
    if (!ch) { setMsgs([]); return }
    const [m, s] = await Promise.all([
      loadMessages(ch).catch(() => null),
      mem && showsCovers(ch, mem) ? loadCoverState(me).catch(err => { console.warn('[team-channel]', err); return null }) : Promise.resolve(null),
    ])
    if (m) setMsgs(m)
    else setMsgs(prev => prev || [])
    if (s) setState(s)
  }, [me?.id, me?.role, channel, people, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload()
    const stop = pollWhileVisible(reload, POLL_MS)
    const on = () => reload()
    window.addEventListener(CHANNEL_CHANGED, on)
    return () => { stop(); window.removeEventListener(CHANNEL_CHANGED, on) }
  }, [reload])

  useEffect(() => {
    if (!msgs) return
    // scroll only inside the message list (never the whole page: the cover cards stay on top)
    const box = endRef.current?.parentElement
    if (box && msgs.length !== lastCount.current) box.scrollTop = box.scrollHeight
    lastCount.current = msgs.length
  }, [msgs])

  const author = { role: me?.role, id: me?.id, name: me?.name }

  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy('send')
    try {
      const saved = await postMessage({ channel: current, kind: 'text', text: body, author })
      setText('')
      pushChannel(saved.path, me)
    } catch (err) { toast.error(err.message) }
    setBusy(null)
  }

  const take = async card => {
    if (!card.fit.ok && ['off', 'weekday'].includes(card.fit.reason)) {
      const ok = await askConfirm({
        title: L('Take it on a day off?', '休みの日に入りますか？', 'Pegar num dia de folga?'),
        message: L('This day is marked as off / not a work day for you. If you take it, the job is yours.', 'この日はあなたの休み（勤務日以外）です。取るとあなたの作業になります。', 'Esse dia está como folga / fora dos seus dias. Se pegar, o serviço fica com você.'),
        confirmLabel: L('Yes, I take it', 'はい、取ります', 'Sim, eu pego'), danger: false,
      })
      if (!ok) return
    }
    setBusy(card.key)
    try {
      const r = await takeCover(card, { id: me.id, name: me.name })
      if (r === 'taken') toast(L('Someone else already took it.', '他の人が先に取りました。', 'Outra pessoa já pegou.'), { icon: '⚡' })
      else toast.success(L("It's yours! It is in your day now.", 'あなたの作業になりました！', 'É seu! Já está no seu dia.'))
      onChanged?.()
    } catch (err) { toast.error(err.message) }
    setBusy(null)
    reload()
  }

  const cancel = async card => {
    const mine = card.from?.id === me?.id
    const ok = await askConfirm({
      title: mine ? L('Cancel your request?', '依頼を取り消しますか？', 'Cancelar seu pedido?') : L(`Close ${card.from?.name}'s request?`, `${card.from?.name}さんの依頼を閉じますか？`, `Fechar o pedido de ${card.from?.name}?`),
      message: L(`The job stays with ${card.from?.name}.`, `作業は${card.from?.name}さんのままです。`, `O serviço continua com ${card.from?.name}.`),
      confirmLabel: L('Yes', 'はい', 'Sim'), danger: false,
    })
    if (!ok) return
    setBusy(card.key)
    try { await cancelCover(card, author) } catch (err) { toast.error(err.message) }
    setBusy(null)
    reload()
  }

  const sendAsk = async () => {
    const job = state.myJobs.find(j => j.id === askJob)
    if (!job) { toast.error(L('Pick the service', 'サービスを選んでください', 'Escolha o serviço')); return }
    setBusy('ask')
    try {
      await askCover(job, { id: me.id, name: me.name }, askReason)
      toast.success(L('Sent to the team. The job stays yours until someone takes it.', 'チームに送りました。誰かが取るまであなたの作業です。', 'Enviado para a equipe. O serviço continua seu até alguém pegar.'))
      setAskOpen(false); setAskJob(''); setAskReason('')
    } catch (err) { toast.error(err.message) }
    setBusy(null)
    reload()
  }

  const offer = async job => {
    const ok = await askConfirm({
      title: L('Offer to the team?', 'チームに募集しますか？', 'Oferecer para a equipe?'),
      message: `${where(jobBrief(job))}\n${L('It shows up in the channel with "I take it". Nobody is assigned until someone takes it.', 'チャンネルに「取る」付きで表示されます。誰かが取るまで担当は決まりません。', 'Aparece no canal com "Eu pego". Ninguém é escolhido até alguém pegar.')}`,
      confirmLabel: L('Offer', '募集する', 'Oferecer'), danger: false,
    })
    if (!ok) return
    setBusy(`offer:${job.id}`)
    try { await offerToTeam(job, author); toast.success(L('Offered to the team', 'チームに募集しました', 'Oferecido para a equipe')) } catch (err) { toast.error(err.message) }
    setBusy(null)
    reload()
  }

  const remove = async m => {
    const ok = await askConfirm({ title: L('Delete this message?', 'このメッセージを削除しますか？', 'Apagar esta mensagem?'), confirmLabel: L('Delete', '削除', 'Apagar'), danger: true })
    if (!ok) return
    try { await deleteMessage(m.path); setMsgs(list => (list || []).filter(x => x.path !== m.path)) } catch (err) { toast.error(err.message) }
  }

  const avatar = (a, size = 34) => (a?.role === 'admin'
    ? <span className="tc-av tc-av-office" style={{ width: size, height: size }}>KP</span>
    : <FaceAvatar id={a?.id} name={a?.name} size={size} className="tc-av" />)

  const fitNote = c => {
    if (c.fit.reason === 'role') return L('Not for your role', 'あなたの担当外です', 'Não é da sua função')
    if (c.fit.reason === 'off') return L('You marked this day off', 'この日は休みです', 'Você marcou folga nesse dia')
    if (c.fit.reason === 'weekday') return L('Not one of your work days', '勤務日ではありません', 'Fora dos seus dias de trabalho')
    return ''
  }

  const cards = state.cards
  const systemLine = m => {
    const w = where(m.job)
    if (m.kind === 'cover') return <>🙋 <b>{L('Needs someone', '担当者募集', 'Precisa de alguém')}</b> · {w}</>
    if (m.kind === 'cant_go') return <>🆘 <b>{L("Can't go — needs cover", '行けません — 代わり募集', 'Não posso ir — precisa de cobertura')}</b> · {w}{m.text ? <em> “{m.text}”</em> : null}</>
    if (m.kind === 'took') return <>✋ <b>{L('Took it', '取りました', 'Pegou')}</b> · {w}{m.text ? ` · ${m.text}` : ''}</>
    if (m.kind === 'cancel') return <>↩️ <b>{L('Request closed', '依頼を終了', 'Pedido fechado')}</b> · {w}{m.text ? ` · ${m.text}` : ''}</>
    return null
  }

  return (
    <div className={`tc${isAdmin ? ' tc-admin' : ''}`}>
      {focus ? (
        <header className="tc-head tc-head-focus">
          {onBack && <button type="button" className="tc-back" onClick={onBack} aria-label={L('Back', '戻る', 'Voltar')}>‹</button>}
          <div className="tc-focus-title">
            <h2>{isDm ? '💬' : CHANNELS.find(x => x.key === focus)?.icon} {nameOf(focus)}</h2>
            <p>{isDm
              ? L('Private: only the two of you see this conversation.', '非公開：この会話は2人だけが見られます。', 'Privado: só vocês dois veem esta conversa.')
              : L('Group: everyone in this channel sees it.', 'グループ：このチャンネルの全員が見られます。', 'Grupo: todos deste canal veem.')}</p>
          </div>
        </header>
      ) : <header className="tc-head">
        <div>
          <h2>👥 {L('Team channels', 'チームチャンネル', 'Canais da Equipe')}</h2>
          <p>{L('One conversation per area. You only see the channels you are in.', 'エリアごとの会話。自分が入っているチャンネルだけ表示されます。', 'Uma conversa por área. Você só vê os canais em que está.')}</p>
        </div>
        {visible.length > 0 && (
          <div className="tc-tabs" role="tablist">
            {visible.map(k => {
              const c = CHANNELS.find(x => x.key === k) || { icon: '💬' }
              return (
                <button key={k} type="button" role="tab" aria-selected={current === k} className={`tc-tab${current === k ? ' is-on' : ''}`}
                  onClick={() => { if (k !== current) { setMsgs(null); setChannel(k); setShowMembers(false) } }}>
                  {c.icon} {nameOf(k)}
                </button>
              )
            })}
          </div>
        )}
        {isAdmin && current && !isDm && (
          <button type="button" className="tc-members-btn" onClick={() => setShowMembers(v => !v)} aria-expanded={showMembers}>
            👥 {L('Members', 'メンバー', 'Membros')} · {people.filter(p => inChannel(p, current, members)).length}
          </button>
        )}
      </header>}

      {isAdmin && showMembers && current && !isDm && (
        <section className="tc-members" aria-label={L('Members', 'メンバー', 'Membros')}>
          <div className="tc-sec-head">
            <h3>👥 {L(`Who is in ${channelLabel(current, 'en')}`, `${channelLabel(current, 'ja')}のメンバー`, `Quem está em ${channelLabel(current, 'pt')}`)}</h3>
          </div>
          <p className="tc-muted">{L('Ticked = sees the channel. "By role" people come in by themselves; untick to remove. Removing hides the channel from the person; the messages stay.', 'チェック＝チャンネルが見えます。「役割で自動」の人は自動で入ります。外すとその人には見えなくなりますが、メッセージは残ります。', 'Marcado = vê o canal. Quem é "pela função" entra sozinho; desmarque para retirar. Retirar só esconde o canal da pessoa; as mensagens ficam.')}</p>
          {current === 'geral' && (
            <label className="tc-mirror">
              <input type="checkbox" checked={!!members?.mirrorCoversInGeral} disabled={busy === 'mirror'}
                onChange={async e => { setBusy('mirror'); try { setMembers(await saveMirror(e.target.checked, me)) } catch (err) { toast.error(err.message) } setBusy(null) }} />
              <span>{L('Also show the cover cards here (they always stay in Cleaning)', '代わり募集カードもここに表示（清掃には常に表示）', 'Mostrar também os cartões de cobertura aqui (eles sempre ficam no Limpeza)')}</span>
            </label>
          )}
          {[
            ['admin', L('Office (admin) — always in every channel', '事務所（管理者）— 全チャンネル', 'Escritório (admin) — sempre em todos os canais')],
            ['employee', L('Employees', 'スタッフ', 'Funcionários')],
            ['salesperson', L('Sales and marketing', '営業・マーケティング', 'Vendas e marketing')],
          ].map(([role, title]) => {
            const list = people.filter(p => p.role === role)
            if (!list.length) return null
            return (
              <div key={role} className="tc-mem-group">
                <div className="tc-mem-title">{title}</div>
                {list.map(p => {
                  const on = inChannel(p, current, members)
                  const auto = autoChannels(p).includes(current)
                  const key = personKey(p)
                  return (
                    <label key={key} className={`tc-mem${on ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={on} disabled={p.role === 'admin' || busy === key}
                        onChange={async e => { setBusy(key); try { setMembers(await saveMember(current, p, e.target.checked, me)) } catch (err) { toast.error(err.message) } setBusy(null) }} />
                      {p.role === 'admin' ? <span className="tc-av tc-av-office" style={{ width: 28, height: 28 }}>KP</span> : <FaceAvatar id={p.id} name={p.name} size={28} className="tc-av" />}
                      <span className="tc-mem-name">{p.name}</span>
                      <small>{p.role === 'admin' ? L('always', '常に', 'sempre') : auto ? (on ? L('by role', '役割で自動', 'pela função') : L('removed by you', '外しました', 'retirado por você')) : (on ? L('added by you', '追加しました', 'adicionado por você') : '')}</small>
                    </label>
                  )
                })}
              </div>
            )
          })}
        </section>
      )}

      {members && !current && <p className="tc-empty tc-head">{L('You are not in any channel yet. The office adds you.', 'まだチャンネルに入っていません。事務所が追加します。', 'Você ainda não está em nenhum canal. O escritório adiciona você.')}</p>}

      {covers && <section className="tc-covers" aria-label={L('Needs cover', '代わり募集', 'Precisa de cobertura')}>
        <div className="tc-sec-head">
          <h3>🙋 {L('Needs cover', '代わり募集', 'Precisa de cobertura')} <span className="tc-n">{cards.length}</span></h3>
          {me?.role === 'employee' && (
            <button type="button" className="tc-ask-btn" onClick={() => setAskOpen(v => !v)} aria-expanded={askOpen}>
              🆘 {L("I can't go to a service", '行けない作業がある', 'Não posso ir num serviço')}
            </button>
          )}
        </div>

        {askOpen && me?.role === 'employee' && (
          <div className="tc-ask">
            {state.myJobs.length === 0
              ? <p className="tc-muted">{L('You have no upcoming service that has not started.', '開始前の予定作業はありません。', 'Você não tem serviço futuro ainda não iniciado.')}</p>
              : (<>
                <p className="tc-muted">{L('Pick the service. It stays yours until someone taps "I take it".', '作業を選んでください。誰かが「取る」を押すまであなたの作業です。', 'Escolha o serviço. Ele continua seu até alguém tocar em "Eu pego".')}</p>
                <div className="tc-ask-list">
                  {state.myJobs.map(j => (
                    <label key={j.id} className={`tc-ask-item${askJob === j.id ? ' is-on' : ''}`}>
                      <input type="radio" name="tc-ask" value={j.id} checked={askJob === j.id} onChange={() => setAskJob(j.id)} />
                      <span>{where(jobBrief(j))}</span>
                    </label>
                  ))}
                </div>
                <input className="tc-input" value={askReason} maxLength={300} onChange={e => setAskReason(e.target.value)} placeholder={L('Why? (optional)', '理由（任意）', 'Motivo (opcional)')} />
                <button type="button" className="tc-primary" disabled={!askJob || busy === 'ask'} onClick={sendAsk}>{busy === 'ask' ? '…' : L('Ask the team for cover', 'チームに代わりを頼む', 'Pedir cobertura para a equipe')}</button>
              </>)}
          </div>
        )}

        {cards.length === 0
          ? <p className="tc-empty">✅ {L('Nothing uncovered right now.', '今は募集中の作業はありません。', 'Nada descoberto agora.')}</p>
          : (
            <ul className="tc-cards">
              {cards.map(c => (
                <li key={c.key} className={`tc-card is-${c.kind}`}>
                  <div className="tc-card-info">
                    <span className="tc-tag">{c.kind === 'free' ? L('No one yet', '担当なし', 'Sem responsável') : L(`${c.from?.name} can't go`, `${c.from?.name}さんが行けません`, `${c.from?.name} não pode ir`)}</span>
                    <strong>{c.brief.store}</strong>
                    {c.brief.service && <span>{c.brief.service}</span>}
                    <small>{day(c.brief.date)}{c.brief.time ? ` · ${c.brief.time}` : ''}</small>
                    {c.reason && <em>“{c.reason}”</em>}
                  </div>
                  <div className="tc-card-btns">
                    {c.canTake && (
                      <button type="button" className="tc-take" disabled={busy === c.key} onClick={() => take(c)}>{busy === c.key ? '…' : `✋ ${L('I take it', '取ります', 'Eu pego')}`}</button>
                    )}
                    {!isAdmin && !c.mine && !c.canTake && <small className="tc-muted">{fitNote(c)}</small>}
                    {!isAdmin && c.canTake && fitNote(c) && <small className="tc-muted">{fitNote(c)}</small>}
                    {c.kind === 'cant_go' && (c.mine || isAdmin) && (
                      <button type="button" className="tc-ghost" disabled={busy === c.key} onClick={() => cancel(c)}>
                        {c.mine ? L('I can go after all — cancel', 'やっぱり行けます — 取消', 'Consegui ir — cancelar') : L('Close request', '依頼を閉じる', 'Fechar pedido')}
                      </button>
                    )}
                    {isAdmin && c.kind === 'free' && <small className="tc-muted">{L('Waiting for someone to take it', '誰かが取るのを待っています', 'Esperando alguém pegar')}</small>}
                  </div>
                </li>
              ))}
            </ul>
          )}

        {isAdmin && state.unassigned.length > 0 && (
          <div className="tc-unassigned">
            <button type="button" className="tc-link" onClick={() => setShowUnassigned(v => !v)} aria-expanded={showUnassigned}>
              {showUnassigned ? '▾' : '▸'} {L(`${state.unassigned.length} with no one, not offered yet`, `担当なし・未募集 ${state.unassigned.length}件`, `${state.unassigned.length} sem responsável, ainda não oferecidos`)}
            </button>
            {showUnassigned && (
              <ul className="tc-cards">
                {state.unassigned.map(j => (
                  <li key={j.id} className="tc-card is-unassigned">
                    <div className="tc-card-info"><strong>{jobBrief(j).store}</strong>{jobBrief(j).service && <span>{jobBrief(j).service}</span>}<small>{day(j.scheduled_date)}{j.scheduled_time ? ` · ${String(j.scheduled_time).slice(0, 5)}` : ''}</small></div>
                    <div className="tc-card-btns"><button type="button" className="tc-ghost" disabled={busy === `offer:${j.id}`} onClick={() => offer(j)}>🙋 {L('Offer to the team', 'チームに募集', 'Oferecer para a equipe')}</button></div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>}

      {current && <section className="tc-feed" aria-label={L('Messages', 'メッセージ', 'Mensagens')}>
        {msgs === null && <p className="tc-muted">{L('Loading…', '読み込み中…', 'Carregando…')}</p>}
        {msgs && msgs.length === 0 && <p className="tc-empty">👋 {isDm
          ? L(`No messages yet. Write to ${nameOf(current)}.`, 'まだメッセージはありません。', `Nenhuma mensagem ainda. Escreva para ${nameOf(current)}.`)
          : L('No messages yet. Say hi to the team!', 'まだメッセージはありません。', 'Nenhuma mensagem ainda. Diga oi para a equipe!')}</p>}
        {(msgs || []).map(m => {
          const mine = m.author?.id === me?.id
          const sys = systemLine(m)
          return (
            <div key={m.path} className={`tc-msg${mine ? ' is-mine' : ''}${sys ? ' is-sys' : ''}`}>
              {avatar(m.author)}
              <div className="tc-bubble">
                <div className="tc-meta"><b>{m.author?.role === 'admin' ? `${m.author?.name || ''} · ${L('Office', '事務所', 'Escritório')}` : m.author?.name}</b><time>{timeOf(m.at)}</time>
                  {isAdmin && <button type="button" className="tc-del" onClick={() => remove(m)} aria-label={L('Delete', '削除', 'Apagar')}>×</button>}
                </div>
                {sys ? <div className="tc-sys">{sys}</div> : <div className="tc-text">{m.text}</div>}
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </section>}

      {current && <div className="tc-compose">
        <textarea rows={1} value={text} maxLength={MAX_TEXT} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          placeholder={isDm ? L(`Message to ${dmOther(current, me, people)?.name || ''}…`, `${dmOther(current, me, people)?.name || ''}へのメッセージ…`, `Mensagem para ${dmOther(current, me, people)?.name || ''}…`) : L(`Message to ${channelLabel(current, 'en')}…`, `${channelLabel(current, 'ja')}へのメッセージ…`, `Mensagem para ${channelLabel(current, 'pt')}…`)} aria-label={L('Message to the team', 'チームへのメッセージ', 'Mensagem para a equipe')} />
        <button type="button" className="tc-send" disabled={!text.trim() || busy === 'send'} onClick={send}>{L('Send', '送信', 'Enviar')}</button>
      </div>}
    </div>
  )
}
