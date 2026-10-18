-- v1.0.56 · Pedidos de orçamento do cliente com vendedor e comissão
-- Só adiciona colunas (nada é apagado nem alterado).
--
-- clients.salesperson_id          vendedor responsável pela conta (cliente que já existe)
-- client_requests.salesperson_id   vendedor que enviou o orçamento ao cliente (fica gravado
--                                  mesmo se o cliente trocar de vendedor depois)
-- client_requests.base_amount      preço que a empresa definiu (o mínimo)
-- client_requests.seller_markup    valor que o vendedor somou = comissão dele
-- client_requests.priced_at        quando a empresa definiu o preço e passou ao vendedor
-- client_requests.commission_paid_at  quando o admin pagou a comissão do vendedor
--
-- Valor que o cliente vê (quote_amount) = base_amount + seller_markup.
-- quote_status ganha o passo 'priced' (empresa definiu o preço, vendedor ainda não enviou);
-- o cliente continua vendo "aguardando orçamento" nesse passo.

alter table public.clients
  add column if not exists salesperson_id uuid references public.salespeople(id) on delete set null;
create index if not exists clients_salesperson_idx on public.clients(salesperson_id);

alter table public.client_requests
  add column if not exists salesperson_id uuid references public.salespeople(id) on delete set null,
  add column if not exists base_amount numeric,
  add column if not exists seller_markup numeric,
  add column if not exists priced_at timestamptz,
  add column if not exists commission_paid_at timestamptz;
create index if not exists client_requests_salesperson_idx on public.client_requests(salesperson_id, created_at desc);
