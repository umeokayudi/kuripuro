// v1.0.117 · Contact person in contract forms: the client's own contact, edited only in the client sheet.
import { pickLang } from '../hooks/useLang'
import { ClientLink } from './ClientSheetHost'
import { clientContact, hasClientContact } from '../lib/clientContact'

export default function ClientContactField({ client, lang, name, phone, onName, onPhone, label }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const title = label || L('Contact person · phone', '担当者・電話', 'Contato · telefone')
  if (client && hasClientContact(client)) {
    const c = clientContact(client)
    return (
      <div className="form-group">
        <label>{title}</label>
        <div style={{ fontSize: 13, padding: '8px 0' }}>
          👤 {[c.name, c.phone].filter(Boolean).join(' · ')}
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {L('Comes from the client record. To change it, ', '顧客情報から表示しています。変更は', 'Vem do cadastro do cliente. Para mudar, ')}
            <ClientLink id={client.id} name={client.company_name}>{L('edit the client sheet', '顧客シートで編集', 'edite a ficha do cliente')}</ClientLink>
            {L('.', 'してください。', '.')}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="form-group">
      <label>{title}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={name || ''} onChange={e => onName(e.target.value)} placeholder="山田" />
        <input value={phone || ''} onChange={e => onPhone(e.target.value)} placeholder="03-…" />
      </div>
      {client && <small style={{ display: 'block', marginTop: 4, color: 'var(--text3)', fontSize: 12 }}>
        {L('This client has no contact yet: what you type here is saved in the client record too.', 'この顧客には担当者が未登録です。ここに入力すると顧客情報にも保存されます。', 'Este cliente ainda não tem contato: o que digitar aqui fica salvo também no cadastro do cliente.')}
      </small>}
    </div>
  )
}
