import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import { pushState, enablePush, ensurePush, watchNotificationTaps } from '../lib/push'

function copy(tr) {
  return {
    label: tr('Push notifications', 'プッシュ通知', 'Notificações no celular'),
    title: tr('Turn on notifications', '通知をオンにする', 'Ativar notificações'),
    body: tr('Get messages, requests and answers on your phone, even with KuriPuro closed.', 'KuriPuroを閉じていても、メッセージや依頼、回答が届きます。', 'Receba mensagens, pedidos e respostas no celular, mesmo com a KuriPuro fechada.'),
    enable: tr('Turn on', 'オンにする', 'Ativar'),
    on: tr('Notifications on', '通知オン', 'Notificações ativadas'),
    allow: tr('Tap “Allow” when the browser asks. You only do this once on each phone.', 'ブラウザに聞かれたら「許可」を押してください。端末ごとに1回だけです。', 'Toque em “Permitir” quando o navegador perguntar. É só uma vez em cada celular.'),
    denied: tr('Notifications are blocked for this site. Allow them in the browser settings.', 'このサイトの通知がブロックされています。ブラウザの設定で許可してください。', 'As notificações estão bloqueadas para este site. Libere nas configurações do navegador.'),
    unsupported: tr('This browser does not support notifications.', 'このブラウザは通知に対応していません。', 'Este navegador não aceita notificações.'),
    ios: tr('On iPhone: tap Share ⬆︎ → “Add to Home Screen”, open KuriPuro from the new icon, then turn notifications on.', 'iPhoneの場合：共有 ⬆︎ →「ホーム画面に追加」→ 新しいアイコンからKuriPuroを開いて通知をオンにしてください。', 'No iPhone: toque em Compartilhar ⬆︎ → “Adicionar à Tela de Início”, abra a KuriPuro pelo novo ícone e ative as notificações.'),
    notReady: tr('Notifications are not set up on the server yet.', 'サーバーの通知設定がまだです。', 'As notificações ainda não foram configuradas no servidor.'),
    failed: tr('Could not turn on notifications.', '通知をオンにできませんでした。', 'Não foi possível ativar as notificações.'),
  }
}

function errorText(c, err) {
  const m = String(err?.message || '')
  if (m === 'denied') return c.denied
  if (m === 'unsupported') return c.unsupported
  if (m === 'not-configured') return c.notReady
  return `${c.failed}${m && m !== 'default' ? ` (${m})` : ''}`
}

// v1.0.194 · Notifications are always on for admin, employees and sellers: no switch, no test,
// no "not now". Browsers still need the person to allow once per device, so until then a card
// stays up with one button. Clients get no push (in-app bell only).
const HIDE_KEY = 'kp_push_card_hidden_until'
const wantsPush = user => Boolean(user && user.role && user.role !== 'client')

/** Mounted once for every signed-in person: keeps this device subscribed and tied to the account. */
export function PushPrompt() {
  const { user } = useAuth() || {}
  const { lang, tr } = useLang()
  const c = copy(tr)
  const [state, setState] = useState(() => pushState())
  const [busy, setBusy] = useState(false)
  // v1.0.224 · When the browser blocks notifications the card can't fix it, so the × keeps it away
  // for 7 days on this device (it used to come back on every page load). The "Ativar" card for a
  // phone that was never asked still has no ×, as before.
  const [hidden, setHidden] = useState(() => { try { return Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now() } catch { return false } })
  const hide = () => { setHidden(true); try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 864e5)) } catch { /* private mode */ } }

  useEffect(() => { watchNotificationTaps() }, [])

  useEffect(() => {
    if (!wantsPush(user)) return
    const now = pushState()
    setState(now)
    if (now === 'granted') ensurePush(user, lang)
  }, [user?.role, user?.id, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!wantsPush(user) || (hidden && state !== 'default') || state === 'granted' || state === 'unsupported') return null
  const enable = async () => {
    setBusy(true)
    try {
      await enablePush(user, lang)
      toast.success(c.on)
      setState('granted')
    } catch (err) {
      toast.error(errorText(c, err))
      setState(pushState())
    } finally { setBusy(false) }
  }
  const text = state === 'ios-needs-home' ? c.ios : state === 'denied' ? c.denied : `${c.body} ${c.allow}`

  return (
    <div role="dialog" aria-label={c.title} style={{
      position: 'fixed', left: 12, right: 12, bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))', zIndex: 9000,
      maxWidth: 380, margin: '0 auto', background: '#fff', color: '#111827', borderRadius: 16,
      boxShadow: '0 12px 32px rgba(15,23,42,.22)', border: '1px solid #e5e9f2', padding: '14px 14px 12px',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <img src="/push-icon-192.png" alt="" aria-hidden="true" width="38" height="38" style={{ width: 38, height: 38, flex: '0 0 38px', borderRadius: 11, boxShadow: '0 6px 16px rgba(49,92,245,.28)' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{c.title}</div>
          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 3, lineHeight: 1.4 }}>{text}</div>
        </div>
        {state !== 'default' && <button type="button" onClick={hide} aria-label="×" style={{ border: 'none', background: 'transparent', color: '#9ca3af', fontSize: 18, cursor: 'pointer', padding: 0 }}>×</button>}
      </div>
      {state === 'default' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={enable} disabled={busy} style={{ border: 'none', background: '#315cf5', color: '#fff', fontWeight: 800, fontSize: 14, padding: '10px 18px', borderRadius: 10, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : c.enable}</button>
        </div>
      )}
    </div>
  )
}

/** Status row for menus: shows whether this phone receives notifications. No switch, no test. */
export function PushToggle({ style }) {
  const { user } = useAuth() || {}
  const { lang, tr } = useLang()
  const c = copy(tr)
  const [state, setState] = useState(() => pushState())
  const [busy, setBusy] = useState(false)
  // v1.0.196 · Silent when it works: the row only shows up in menus when this phone still needs a tap.
  if (!wantsPush(user) || state === 'granted' || state === 'unsupported') return null
  const on = false
  const enable = async () => {
    setBusy(true)
    try { await enablePush(user, lang); setState('granted'); toast.success(c.on) } catch (err) { toast.error(errorText(c, err)); setState(pushState()) } finally { setBusy(false) }
  }
  const hint = state === 'ios-needs-home' ? c.ios : state === 'denied' ? c.denied : state === 'unsupported' ? c.unsupported : on ? c.on : c.allow
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: '#f8fafc', border: '1px solid #e5e9f2', ...style }}>
      <span aria-hidden="true" style={{ fontSize: 20 }}>{on ? '🔔' : '🔕'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#111827' }}>{c.label}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 1.35 }}>{hint}</div>
      </div>
      {state === 'default' && <button type="button" onClick={enable} disabled={busy} style={{ border: 'none', background: '#315cf5', color: '#fff', fontWeight: 800, fontSize: 12, padding: '8px 12px', borderRadius: 9, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : c.enable}</button>}
    </div>
  )
}
