/// <reference types="@cloudflare/workers-types" />

type Env = {
  DB: D1Database;
};

// GET /api/metrics/discharge-delay?from=YYYY-MM-DD&to=YYYY-MM-DD&ward=MED
export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const ward = url.searchParams.get("ward");

  if (!from || !to) {
    return json(
      { error: "from and to query parameters are required (YYYY-MM-DD)" },
      400,
    );
  }

  // อ่านจาก discharge_plans แบบ read-only และไม่เลือกคอลัมน์ hn
  // ใช้ single prepared statement ตามข้อกำหนด "no dynamic SQL"
  const sql = `
    SELECT
      fit_discharge_date AS date,
      ward,
      SUM(CASE WHEN delay_days > 0 THEN 1 ELSE 0 END) AS delayed_cases,
      ROUND(AVG(CASE WHEN delay_days > 0 THEN delay_days END), 1) AS mean_delay_days
    FROM discharge_plans
    WHERE fit_discharge_date BETWEEN ? AND ?
      AND (? IS NULL OR ward = ?)
    GROUP BY fit_discharge_date, ward
    ORDER BY date ASC
  `;

  const params: (string | null)[] = [from, to, ward, ward];

  const stmt = context.env.DB.prepare(sql);
  const result = await stmt
    .bind(...params)
    .all<{ date: string; ward: string; delayed_cases: number; mean_delay_days: number }>();

  const suppressed = (result.results || []).map((row) => ({
    ...row,
    // Small cell suppression for counts < 5
    delayed_cases: row.delayed_cases < 5 ? "<5" : row.delayed_cases,
  }));

  return json({ data: suppressed });
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

