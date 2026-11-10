export type ChatArchiveSource = {
  customers: number;
  sessions: number;
  messages: number;
  from: string;
  through: string;
  stores: {
    shop: string; fileName: string; customers: number; sessions: number;
    messages: number; latest: string;
  }[];
};

type ArchiveSession = {
  shop: string; customerId: string; count: number; first: string; last: string; sourceRef: string;
};

export function chatArchiveSource(sessions: ArchiveSession[], customers: number): ChatArchiveSource {
  const byShop = new Map<string, ArchiveSession[]>();
  for (const session of sessions) {
    const rows = byShop.get(session.shop) ?? [];
    rows.push(session);
    byShop.set(session.shop, rows);
  }
  return {
    customers,
    sessions: sessions.length,
    messages: sessions.reduce((count, row) => count + row.count, 0),
    from: sessions.map(row => row.first).filter(Boolean).sort()[0]?.slice(0, 10) || '',
    through: sessions.map(row => row.last).sort().at(-1)?.slice(0, 10) || '',
    stores: [...byShop].map(([shop, rows]) => ({
      shop, fileName: rows[0].sourceRef,
      customers: new Set(rows.map(row => row.customerId)).size,
      sessions: rows.length,
      messages: rows.reduce((count, row) => count + row.count, 0),
      latest: rows.map(row => row.last).sort().at(-1) || '',
    })),
  };
}
