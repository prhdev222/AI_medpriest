/// <reference types="@cloudflare/workers-types" />

type Env = {
  TURSO_HTTP_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

// GET /api/usage/stats
// คืนเฉพาะผลรวม: จำนวนครั้งที่ถาม AI (chat) และเปิดหน้า (open) — ไม่แสดงรายการเหตุการณ์หรือคำถาม
export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.TURSO_HTTP_URL || !context.env.TURSO_AUTH_TOKEN) {
      return json(
        { error: "Turso not configured", total_chat: 0, total_open: 0 },
        200,
      );
    }

    const result = await tursoExecute(
      context.env,
      `SELECT event_type, COUNT(*) AS cnt FROM usage_events GROUP BY event_type`,
    );

    const rows =
      result.response?.result?.rows ??
      result.response?.rows ??
      [];

    let total_chat = 0;
    let total_open = 0;

    const getCell = (cell: any): string =>
      cell?.text ?? cell?.value ?? (cell?.integer != null ? String(cell.integer) : "") ?? "";
    const getCount = (cell: any): number => {
      const n = cell?.integer ?? (typeof cell?.text === "string" ? parseInt(cell.text, 10) : NaN);
      return Number.isFinite(n) ? n : (typeof cell?.value === "string" ? parseInt(cell.value, 10) : 0) || 0;
    };

    for (const row of rows) {
      const v = row.values ?? (Array.isArray(row) ? row : []);
      const typeCell = v[0] ?? {};
      const countCell = v[1] ?? {};
      const event_type = getCell(typeCell);
      const count = getCount(countCell);
      if (event_type === "chat") total_chat = count;
      else if (event_type === "open") total_open = count;
    }

    return json({ total_chat, total_open });
  } catch (err) {
    console.error("usage stats error", err);
    return json({ error: "cannot load usage stats", total_chat: 0, total_open: 0 }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function tursoArgs(values: (string | number)[]): { type: string; value: string }[] {
  return values.map((v) => ({
    type: typeof v === "number" ? (Number.isInteger(v) ? "integer" : "float") : "text",
    value: String(v),
  }));
}

async function tursoExecute(env: Env, sql: string, args: (string | number)[] = []) {
  if (!env.TURSO_HTTP_URL || !env.TURSO_AUTH_TOKEN) {
    throw new Error("Turso not configured");
  }
  const stmt: { sql: string; args?: { type: string; value: string }[] } = { sql };
  if (args.length > 0) stmt.args = tursoArgs(args);
  const res = await fetch(env.TURSO_HTTP_URL.replace(/\/$/, "") + "/v2/pipeline", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt },
        { type: "close" },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Turso HTTP error: ${res.status}`);
  }

  const data = await res.json();
  return data.results?.[0] ?? {};
}

