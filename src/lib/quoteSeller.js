// v1.0.67 · Who is the seller of a client quote request.
// Used by the API (seller list, price → seller) and by the admin screens, so no imports here.
//
// Order: the seller already on the request (sent it, or the admin assigned it) → the account
// seller on the client → the seller on that store's contract → any seller on the client's contracts.

const storeBase = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim().toLowerCase()

/** contracts: service_contracts rows ({ client_id, location_name, salesperson_id }) of any client. */
export function quoteSellerFor(request, client, contracts = []) {
  if (request?.salesperson_id) return request.salesperson_id
  if (client?.salesperson_id) return client.salesperson_id
  const own = (contracts || []).filter(c => c.salesperson_id && c.client_id === request?.client_id)
  const store = storeBase(request?.location_name)
  const sameStore = store && own.find(c => storeBase(c.location_name) === store)
  return (sameStore || own[0])?.salesperson_id || null
}
