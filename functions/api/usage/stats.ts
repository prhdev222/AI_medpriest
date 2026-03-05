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
        {
          error: "Turso not configured",
          hint: "ตั้งค่า TURSO_HTTP_URL และ TURSO_AUTH_TOKEN ใน Cloudflare Pages → Settings → Environment variables",
          total_chat: 0,
          total_open: 0,
        },
        200,
      );
    }

    const result = await tursoExecute(
      context.env,
      `SELECT event_type, COUNT(*) AS cnt FROM usage_events GROUP BY event_type`,
    );

    const rawResult = result.response?.result ?? result.response;
    const rows: any[] = Array.isArray(rawResult?.rows)
      ? rawResult.rows
      : [];

    let total_chat = 0;
    let total_open = 0;

    const getCellText = (cell: any): string => {
      if (cell == null) return "";
      if (typeof cell === "string") return cell;
      return cell?.text ?? cell?.value ?? (cell?.integer != null ? String(cell.integer) : "") ?? "";
    };
    const getCellInt = (cell: any): number => {
      if (cell == null) return 0;
      if (typeof cell === "number" && Number.isFinite(cell)) return cell;
      const n = cell?.integer ?? (typeof cell?.text === "string" ? parseInt(cell.text, 10) : NaN);
      if (Number.isFinite(n)) return n;
      const v = cell?.value;
      return typeof v === "string" ? parseInt(v, 10) || 0 : 0;
    };

    for (const row of rows) {
      const v = Array.isArray(row) ? row : row?.values ?? [];
      const typeCell = v[0];
      const countCell = v[1];
      const event_type = getCellText(typeCell);
      const count = getCellInt(countCell);
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
  const first = data.results?.[0];
  if (first?.type === "error") throw new Error(first.error?.message ?? "Turso query error");
  return first ?? {};
}

