import { useEffect, useRef, useState } from 'react'
import { readOneTag, matchTag, tagPlace } from '../lib/nfcClock'
import { businessName } from '../lib/nearbyJob'
import { fill } from '../i18n/translations'

const btn = { padding: '13px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }

/** "Tap the sticker" sheet shown before starting or finishing a job when NFC clock is on. */
export default function NfcScanSheet({ phase, job, tags, labels: l, onDone, onCancel }) {
  const [state, setState] = useState('waiting') // waiting | error | warn
  const [warn, setWarn] = useState(null)
  const readRef = useRef(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const read = readOneTag()
    readRef.current = read
    setState('waiting')
    read.promise.then(uid => {
      const r = matchTag(uid, tags, job)
      const result = { uid, status: r.status, tag: r.tag }
      if (r.status === 'ok') { if (navigator.vibrate) navigator.vibrate(80); onDone(result) }
      else { setWarn(result); setState('warn') }
    }).catch(err => { if (err?.message !== 'cancelled') setState('error') })
    return () => read.cancel()
  }, [attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => { readRef.current?.cancel(); onCancel() }
  const skip = () => { readRef.current?.cancel(); onDone({ uid: null, status: 'skipped', tag: null }) }
  const place = businessName(job)

  return (
    <div className="emp-sheet-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div className="emp-sheet" style={{ background: '#0d1f35', borderRadius: '24px 24px 0 0', padding: '20px 20px 40px', textAlign: 'center' }}>
        <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 18px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{phase === 'start' ? l.nfcTitleStart : l.nfcTitleEnd}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 18 }}>{place}</div>

        {state === 'waiting' && <>
          <div className="nfc-pulse" style={{ fontSize: 54, margin: '6px 0 12px' }} aria-hidden="true">📶</div>
          <div style={{ fontSize: 14, color: '#fff', marginBottom: 18 }}>{l.nfcHold}</div>
        </>}
        {state === 'error' && <>
          <div style={{ fontSize: 14, color: '#fbbf24', margin: '10px 0 14px' }}>⚠️ {l.nfcReadError}</div>
          <button onClick={() => setAttempt(a => a + 1)} style={{ ...btn, width: '100%', marginBottom: 10, color: '#fff' }}>↻ {l.nfcTryAgain}</button>
        </>}
        {state === 'warn' && warn && <>
          <div style={{ fontSize: 14, color: '#fbbf24', margin: '10px 0 6px' }}>
            ⚠️ {warn.status === 'other_place' ? fill(l.nfcOtherPlace, { place: tagPlace(warn.tag) }) : l.nfcUnknownTag}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 14 }}>{l.nfcLogged}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <button onClick={() => { setWarn(null); setAttempt(a => a + 1) }} style={btn}>↻ {l.nfcTryAgain}</button>
            <button onClick={() => onDone(warn)} style={{ ...btn, border: 'none', background: 'linear-gradient(135deg,#c19c56,#e8c47a)', color: '#0a1929', fontWeight: 700 }}>{l.nfcContinueAnyway}</button>
          </div>
        </>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button onClick={cancel} style={btn}>{l.cancel || 'Cancel'}</button>
          <button onClick={skip} style={btn}>{l.nfcNoSticker}</button>
        </div>
      </div>
    </div>
  )
}
