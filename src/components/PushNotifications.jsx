import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import { pushState, enablePush, disablePush, syncPush, isSubscribed, sendTestPush, pushDismissedRecently, dismissPush } from '../lib/push'

function copy(tr) {
  return {
    label: tr('Push notifications', 'プッシュ通知', 'Notificações no celular'),
    title: tr('Turn on notifications', '通知をオンにする', 'Ativar notificações'),
    body: tr('Get messages, requests and answers on your phone, even with KuriPuro closed.', 'KuriPuroを閉じていても、メッセージや依頼、回答が届きます。', 'Receba mensagens, pedidos e respostas no celular, mesmo com a KuriPuro fechada.'),
    enable: tr('Turn on', 'オンにする', 'Ativar'),
    later: tr('Not now', 'あとで', 'Agora não'),
    on: tr('Notifications on', '通知オン', 'Notificações ativadas'),
    off: tr('Notifications off', '通知オフ', 'Notificações desativadas'),
    test: tr('Send test', 'テスト送信', 'Enviar teste'),
    testSent: tr('Test sent — check your notifications.', 'テストを送信しました。', 'Teste enviado — veja suas notificações.'),
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

/**
 * Mounted once for every signed-in person: keeps the subscription tied to the account
 * and offers, once a week at most, a small card to turn notifications on.
 */
export function PushPrompt() {
  const { user } = useAuth() || {}
  const { lang, tr } = useLang()
  const c = copy(tr)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const state = user ? pushState() : 'unsupported'

  useEffect(() => {
    if (!user) { setShow(false); return undefined }
    syncPush(user, lang)
    if ((state !== 'default' && state !== 'ios-needs-home') || pushDismissedRecently()) return undefined
    const timer = window.setTimeout(() => setShow(true), 4000)
    return () => window.clearTimeout(timer)
  }, [user?.role, user?.id, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!show || !user) return null
  const close = () => { dismissPush(); setShow(false) }
  const enable = async () => {
    setBusy(true)
    try {
      await enablePush(user, lang)
      toast.success(c.on)
      setShow(false)
    } catch (err) {
      toast.error(errorText(c, err))
      if (String(err?.message) === 'denied') close()
    } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-label={c.title} style={{
      position: 'fixed', left: 12, right: 12, bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))', zIndex: 9000,
      maxWidth: 380, margin: '0 auto', background: '#fff', color: '#111827', borderRadius: 16,
      boxShadow: '0 12px 32px rgba(15,23,42,.22)', border: '1px solid #e5e9f2', padding: '14px 14px 12px',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div aria-hidden="true" style={{ width: 38, height: 38, flex: '0 0 38px', borderRadius: 12, background: '#eef2ff', display: 'grid', placeItems: 'center', fontSize: 19 }}>🔔</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{c.title}</div>
          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 3, lineHeight: 1.4 }}>{state === 'ios-needs-home' ? c.ios : c.body}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" onClick={close} style={{ border: 'none', background: 'transparent', color: '#6b7280', fontWeight: 700, fontSize: 13, padding: '9px 12px', cursor: 'pointer' }}>{c.later}</button>
        {state !== 'ios-needs-home' && (
          <button type="button" onClick={enable} disabled={busy} style={{ border: 'none', background: '#315cf5', color: '#fff', fontWeight: 800, fontSize: 13, padding: '9px 16px', borderRadius: 10, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : c.enable}</button>
        )}
      </div>
    </div>
  )
}

/** A row for menus/settings: shows the state, turns push on or off, sends a test. */
export function PushToggle({ style }) {
  const { user } = useAuth() || {}
  const { lang, tr } = useLang()
  const c = copy(tr)
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const state = pushState()

  useEffect(() => { isSubscribed().then(v => setOn(v && state === 'granted')) }, [state])

  const toggle = async () => {
    setBusy(true)
    try {
      if (on) { await disablePush(); setOn(false); toast.success(c.off) }
      else { await enablePush(user, lang); setOn(true); toast.success(c.on) }
    } catch (err) { toast.error(errorText(c, err)) } finally { setBusy(false) }
  }
  const test = async () => {
    const sent = await sendTestPush(user)
    if (sent) toast.success(c.testSent); else toast.error(c.failed)
  }

  const hint = state === 'ios-needs-home' ? c.ios : state === 'denied' ? c.denied : state === 'unsupported' ? c.unsupported : on ? c.on : c.body
  const canToggle = state === 'default' || state === 'granted'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: '#f8fafc', border: '1px solid #e5e9f2', ...style }}>
      <span aria-hidden="true" style={{ fontSize: 20 }}>{on ? '🔔' : '🔕'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#111827' }}>{c.label}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 1.35 }}>{hint}</div>
      </div>
      {on && <button type="button" onClick={test} style={{ border: '1px solid #d6dcea', background: '#fff', color: '#374151', fontWeight: 700, fontSize: 12, padding: '7px 10px', borderRadius: 9, cursor: 'pointer' }}>{c.test}</button>}
      {canToggle && (
        <button type="button" role="switch" aria-checked={on} onClick={toggle} disabled={busy} aria-label={c.title}
          style={{ width: 48, height: 28, flex: '0 0 48px', borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: on ? '#22c55e' : '#cbd5e1', opacity: busy ? 0.6 : 1, transition: 'background .2s' }}>
          <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'left .2s' }} />
        </button>
      )}
    </div>
  )
}

