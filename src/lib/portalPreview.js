// v1.0.155 · Admin "Ver como o cliente": the client portal runs with this wrapper around supabase.
// Reads (select, storage list / public URLs) go through as normal; every write is refused, so the
// preview can never change the client's data, ratings, chat, last_seen or files.
export const PREVIEW_BLOCKED = {
  pt: 'Prévia do cliente — somente leitura. Nada foi alterado.',
  en: 'Client preview — read only. Nothing was changed.',
  ja: 'お客様画面のプレビュー（閲覧のみ）。変更はされていません。',
}

const blockedResult = () => ({ data: null, error: { message: PREVIEW_BLOCKED.pt, code: 'preview' }, count: null, status: 403 })

// A builder that accepts any chain (.eq().select().single()...) and resolves to the blocked result.
function blockedBuilder() {
  const target = function () {}
  const proxy = new Proxy(target, {
    get(_, prop) {
      if (prop === 'then') return (ok, ko) => Promise.resolve(blockedResult()).then(ok, ko)
      if (prop === 'catch') return fn => Promise.resolve(blockedResult()).catch(fn)
      if (prop === 'finally') return fn => Promise.resolve(blockedResult()).finally(fn)
      return () => proxy
    },
    apply() { return proxy },
  })
  return proxy
}

const WRITE_DB = new Set(['insert', 'update', 'upsert', 'delete'])
const WRITE_STORAGE = new Set(['upload', 'update', 'remove', 'move', 'copy', 'createSignedUploadUrl', 'uploadToSignedUrl'])

function wrapTable(builder) {
  return new Proxy(builder, {
    get(t, prop) {
      if (WRITE_DB.has(prop)) return () => blockedBuilder()
      const v = Reflect.get(t, prop, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}

function wrapBucket(bucket) {
  return new Proxy(bucket, {
    get(t, prop) {
      if (WRITE_STORAGE.has(prop)) return async () => blockedResult()
      const v = Reflect.get(t, prop, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}

/** Read-only view of a supabase client (tables, rpc, storage). */
export function readOnlyDb(client) {
  const storage = new Proxy(client.storage, {
    get(t, prop) {
      if (prop === 'from') return name => wrapBucket(t.from(name))
      const v = Reflect.get(t, prop, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
  return new Proxy(client, {
    get(t, prop) {
      if (prop === 'from') return name => wrapTable(t.from(name))
      if (prop === 'rpc') return () => blockedBuilder()
      if (prop === 'storage') return storage
      if (prop === 'channel') return (...a) => t.channel(...a)
      const v = Reflect.get(t, prop, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}
