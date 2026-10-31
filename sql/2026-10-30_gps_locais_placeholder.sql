-- v1.0.103 · Coordenada falsa nos locais (NÃO aplicado — precisa do OK do dono)
-- 11 locais (Kodama Shinbashi/Kinshicho/Oimachi, Tooda, Ibushio, Nyu Ibushio, Sakana Yakio, Sakana Yakio 2,
-- Nyu Sakana Yakio, Horumon no Manmosu, Yakiniku Otoko Manmosu) têm o MESMO ponto 35.6585, 139.7514
-- (perto do Shiba-koen). O app mediu a distância até esse ponto: ~800 m em Shinbashi mesmo dentro da loja.
-- O app v1.0.103 já ignora esse ponto e usa o endereço (link do Maps), que dá 3–40 m na loja.
-- Este SQL limpa o dado para os outros lugares do sistema (admin, mapa, relatórios).

begin;

-- 1) Distâncias já gravadas contra o ponto falso (ex.: 829 m / 809 m) deixam de contar como "fora do local".
--    O GPS do funcionário (start_lat/end_lat) continua guardado. Roda antes do passo 3.
update jobs set gps_start_distance = null, gps_end_distance = null
where gps_lat = 35.6585 and gps_lng = 139.7514
  and (gps_start_distance is not null or gps_end_distance is not null);

-- 2) Locais: tira o ponto falso (o app passa a usar o endereço).
update locations set gps_lat = null, gps_lng = null
where gps_lat = 35.6585 and gps_lng = 139.7514;

-- 3) Serviços que copiaram o ponto falso.
update jobs set gps_lat = null, gps_lng = null
where gps_lat = 35.6585 and gps_lng = 139.7514;

commit;
