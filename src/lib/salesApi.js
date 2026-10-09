const DEV_API_HINT = {
  en: 'The project API is not running on this server. Vite serves the interface, but /api routes require `vercel dev` and the server environment variables.',
  ja: 'このサーバーではプロジェクトのAPIが起動していません。Viteは画面のみを配信します。/apiルートには `vercel dev` とサーバー環境変数が必要です。',
}

async function readResponse(response, lang) {
  const contentType = response.headers.get('content-type') || ''
  const raw = await response.text()
  let result
  if (contentType.includes('application/json')) {
    try { result = JSON.parse(raw) } catch { result = null }
  } else {
    try { result = JSON.parse(raw) } catch { result = null }
  }

  if (!result || typeof result !== 'object') {
    throw new Error(contentType.includes('javascript') || raw.trimStart().startsWith('import ')
      ? DEV_API_HINT[lang === 'ja' ? 'ja' : 'en']
      : (lang === 'ja' ? 'サーバーから無効な応答が返されました。API設定を確認して、もう一度お試しください。' : 'The server returned an invalid response. Check the API configuration and try again.'))
  }
  if (!response.ok) throw new Error(result.error || `Falha na API (${response.status}).`)
  return result
}

export async function salesGet(path, lang = 'en') {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
  return readResponse(response, lang)
}

export async function salesPost(path, body, lang = 'en') {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readResponse(response, lang)
}
