import type { DataClient, Row } from "./types";

interface Q extends PromiseLike<{
  data: Row[] | null;
  error: { message: string } | null;
}> {
  eq(c: string, v: string): Q;
  in(c: string, v: string[]): Q;
  gte(c: string, v: string): Q;
  order(c: string, o: { ascending: boolean }): Q;
  limit(n: number): Q;
}
interface Loose {
  from(t: string): { select(cols: string): Q };
  rpc(
    n: string,
    a: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Wraps the signed-in person's Supabase client. Everything runs with their session, so RLS applies. */
export function supabaseData(sb: unknown): DataClient {
  const c = sb as Loose;
  return {
    async select(table, o) {
      let q = c.from(table).select(o.columns);
      for (const [k, v] of Object.entries(o.eq ?? {})) q = q.eq(k, v);
      for (const [k, v] of Object.entries(o.inList ?? {})) q = q.in(k, v);
      for (const [k, v] of Object.entries(o.gte ?? {})) q = q.gte(k, v);
      if (o.order)
        q = q.order(o.order.column, { ascending: o.order.ascending });
      return await q.limit(o.limit);
    },
    async rpc(name, args) {
      return await c.rpc(name, args);
    },
  };
}
