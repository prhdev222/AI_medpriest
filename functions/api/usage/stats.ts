/// <reference types="@cloudflare/workers-types" />

type Env = {
  TURSO_HTTP_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

// GET /api/usage/stats
// คืนสถิติแบบเรียบง่าย เป็นจำนวนการเปิดหน้า (open) และการถาม AI (chat) แยกตามวัน
export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.TURSO_HTTP_URL || !context.env.TURSO_AUTH_TOKEN) {
      return json(
        { error: "Turso not configured", data: [] },
        200,
      );
    }

    const result = await tursoExecute(
      context.env,
      `
      SELECT
        date(created_at) AS date,
        event_type,
        COUNT(*) AS count
      FROM usage_events
      GROUP BY date, event_type
      ORDER BY date DESC, event_type ASC
      `,
    );

    const rows =
      result.response?.result?.rows ??
      result.response?.rows ??
      [];

    // แปลงรูปแบบค่าจาก Turso ให้เป็น object เรียบง่ายสำหรับ frontend
    const data = rows.map((row: any) => {
      const v = row.values || [];
      const dateCell = v[0] || {};
      const typeCell = v[1] || {};
      const countCell = v[2] || {};

      const date =
        dateCell.text ??
        dateCell.blob ??
        (dateCell.integer != null ? String(dateCell.integer) : "");

      const event_type =
        typeCell.text ??
        typeCell.blob ??
        (typeCell.integer != null ? String(typeCell.integer) : "");

      const countRaw =
        countCell.integer ??
        (typeof countCell.text === "string" ? parseInt(countCell.text, 10) : 0);

      const count = Number.isFinite(countRaw) ? Number(countRaw) : 0;

      return { date, event_type, count };
    });

    return json({ data });
  } catch (err) {
    console.error("usage stats error", err);
    return json({ error: "cannot load usage stats" }, 500);
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

