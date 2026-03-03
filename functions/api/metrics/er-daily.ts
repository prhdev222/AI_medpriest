/// <reference types="@cloudflare/workers-types" />

type Env = {
  DB: D1Database;
};

// GET /api/metrics/er-daily?from=YYYY-MM-DD&to=YYYY-MM-DD
export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!from || !to) {
    return json(
      { error: "from and to query parameters are required (YYYY-MM-DD)" },
      400,
    );
  }

  const sql = `
    SELECT
      date,
      count
    FROM er
    WHERE date BETWEEN ? AND ?
    ORDER BY date ASC
  `;

  const stmt = context.env.DB.prepare(sql);
  const result = await stmt
    .bind(from, to)
    .all<{ date: string; count: number }>();

  return json({ data: result.results || [] });
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

