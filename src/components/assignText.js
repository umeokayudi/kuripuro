// v1.0.101 · Texts of the assignment flow (EN / JA / PT), shared by the Assign screen and the Agenda.
export function assignText(tr) {
  return {
    reason: {
      notCreated: tr('Not created yet', '未作成', 'Falta criar'),
      contractMissing: tr('Contract visit with no job', '契約の訪問に作業なし', 'Visita do contrato sem job'),
      noPerson: tr('No person', '担当なし', 'Sem pessoa'),
      spotDeclined: tr('Spot declined', 'スポット辞退', 'Spot recusado'),
      offerOpen: tr('Offer open, waiting', 'オファー中（承諾待ち）', 'Oferta aberta, esperando'),
      personGone: tr('Person inactive', '担当者が退職', 'Pessoa inativa'),
      personOff: tr('Person on day off', '担当者が休み', 'Pessoa de folga'),
    },
    conflict: {
      inactive: tr('inactive', '退職', 'inativo'),
      test: tr('test account', 'テスト用', 'conta de teste'),
      role: tr('wrong role', '役割が違う', 'papel errado'),
      roleDeep: tr('trainee on deep clean', '研修中に重作業', 'em treinamento na limpeza pesada'),
      off: tr('day off', '休み', 'folga'),
      weekday: tr('does not work this weekday', 'この曜日は勤務なし', 'não trabalha nesse dia'),
      overlap: tr('same time as', '同時刻:', 'mesmo horário de'),
      travel: tr('no time to travel from/to', '移動時間なし:', 'sem tempo de deslocamento com'),
      unknown: tr('unknown person', '不明', 'pessoa desconhecida'),
    },
    why: {
      owner: tr('usually does this place', 'いつもの担当', 'costuma fazer este local'),
      sameArea: tr('already in this area today', '今日この地域にいる', 'já está nesta área hoje'),
      onRoute: tr('already has a route today', '今日ルートあり', 'já tem rota no dia'),
      extra: tr('marked extra work', '追加勤務あり', 'marcou trabalho extra'),
      lightWeek: tr('lightest week', '今週いちばん少ない', 'semana mais leve'),
      route: tr('route owner', 'ルート担当', 'dono da rota'),
      covering: tr('covering for', '代わり:', 'cobrindo'),
    },
    role: {
      cleaning: tr('Cleaning staff', '清掃スタッフ', 'Equipe de limpeza'),
      deep: tr('Deep clean (not trainee)', '重作業（研修中以外）', 'Limpeza pesada (sem trainee)'),
    },
    type: {
      basic: tr('Basic', 'ベーシック', 'Básica'),
      deep: tr('Deep', 'ディープ', 'Pesada'),
      spot: tr('Spot', 'スポット', 'Spot'),
    },
  }
}

/** "same time as Ibushio 00:30" */
export function conflictLabel(c, T) {
  const base = T.conflict[c.kind] || c.kind
  return c.with ? `${base} ${c.with}${c.time ? ` ${c.time}` : ''}` : base
}

export const RED_CONFLICTS = new Set(['off', 'overlap', 'role', 'inactive', 'unknown'])
