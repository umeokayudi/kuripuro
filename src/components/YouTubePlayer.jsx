// v1.0.190 · YouTube IFrame Player API (no key needed) — plays a training video inside the app,
// resumes where the person stopped, and reports real watched seconds once per second.
import { useEffect, useRef } from 'react'

let apiPromise = null
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT) }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube não carregou')) }
    document.head.appendChild(s)
  })
  return apiPromise
}

/**
 * onTick({ current, duration, lastCurrent }) every second while playing,
 * onPause({ current, duration }), onEnded({ duration }).
 */
export default function YouTubePlayer({ videoId, start = 0, onTick, onPause, onEnded, onError }) {
  const host = useRef(null)
  const cb = useRef({})
  cb.current = { onTick, onPause, onEnded, onError }

  useEffect(() => {
    let player = null
    let timer = null
    let last = Math.floor(start || 0)
    let alive = true
    const stopTimer = () => { if (timer) clearInterval(timer); timer = null }
    loadYouTubeApi().then(YT => {
      if (!alive || !host.current) return
      const el = document.createElement('div')
      host.current.innerHTML = ''
      host.current.appendChild(el)
      player = new YT.Player(el, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(start || 0) },
        events: {
          onStateChange: ev => {
            const st = ev.data
            if (st === YT.PlayerState.PLAYING) {
              last = player.getCurrentTime?.() || last
              stopTimer()
              timer = setInterval(() => {
                const current = player.getCurrentTime?.() || 0
                const duration = player.getDuration?.() || 0
                cb.current.onTick?.({ current, duration, lastCurrent: last })
                last = current
              }, 1000)
            } else {
              stopTimer()
              const current = player.getCurrentTime?.() || 0
              const duration = player.getDuration?.() || 0
              if (st === YT.PlayerState.ENDED) cb.current.onEnded?.({ duration })
              else if (st === YT.PlayerState.PAUSED) cb.current.onPause?.({ current, duration })
              last = current
            }
          },
          onError: ev => cb.current.onError?.(ev.data),
        },
      })
    }).catch(e => cb.current.onError?.(e.message))
    return () => {
      alive = false
      stopTimer()
      try {
        const current = player?.getCurrentTime?.() || 0
        const duration = player?.getDuration?.() || 0
        if (current) cb.current.onPause?.({ current, duration })
        player?.destroy?.()
      } catch { /* already gone */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId])

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 14, overflow: 'hidden' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}
