// v1.0.117 · Shows the one-time "create your password" link right after a login is created.
import toast from 'react-hot-toast'
import { pickLang } from '../hooks/useLang'

export default function SetupLinkCard({ name, url, lang, onClose }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const copy = () => navigator.clipboard?.writeText(url)
    .then(() => toast.success(L('Link copied', 'リンクをコピーしました', 'Link copiado')))
    .catch(() => toast.error(L('Copy it by hand', '手動でコピーしてください', 'Copie à mão')))
  const share = `https://wa.me/?text=${encodeURIComponent(L('Create your KuriPuro password: ', 'KuriPuroのパスワードを作成してください: ', 'Crie sua senha do KuriPuro: ') + url)}`
  return (
    <div className="card" style={{ marginBottom: 14, border: '1px solid var(--navy)' }}>
      <div className="card-title">🔑 {L(`Password link for ${name}`, `${name}のパスワード設定リンク`, `Link de senha de ${name}`)}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
        {L('Send this link to the person. They open it, create their own password and then sign in. It works once; nobody else sees the password.',
          'このリンクを本人に送ってください。開いて自分のパスワードを作成し、ログインします。1回だけ使えます。パスワードは他の人には見えません。',
          'Envie este link para a pessoa. Ela abre, cria a própria senha e depois entra. Vale uma vez; ninguém mais vê a senha.')}
      </div>
      <input readOnly value={url} onFocus={e => e.target.select()} style={{ width: '100%', fontSize: 12, marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={copy}>📋 {L('Copy link', 'リンクをコピー', 'Copiar link')}</button>
        <a className="btn btn-sm" href={share} target="_blank" rel="noreferrer">💬 WhatsApp</a>
        <button type="button" className="btn btn-sm" onClick={onClose}>{L('Close', '閉じる', 'Fechar')}</button>
      </div>
    </div>
  )
}
