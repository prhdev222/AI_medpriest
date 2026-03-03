/// <reference types="@cloudflare/workers-types" />

type Env = {
  DB: D1Database;
};

// GET /api/metrics/ipd-daily?from=YYYY-MM-DD&to=YYYY-MM-DD&ward=MED
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

  // อ่านจากตาราง raw ipd_stays แบบ read-only และไม่เลือกคอลัมน์ hn
  // ใช้ single prepared statement ตามข้อกำหนด "no dynamic SQL"
  const sql = `
    SELECT
      date(admit_date) AS date,
      ward,
      COUNT(*) AS admissions,
      SUM(CASE WHEN discharge_date <> '' THEN 1 ELSE 0 END) AS discharges,
      ROUND(AVG(CASE WHEN los > 0 THEN los END), 1) AS avg_los
    FROM ipd_stays
    WHERE admit_date BETWEEN ? AND ?
      AND (? IS NULL OR ward = ?)
    GROUP BY date(admit_date), ward
    ORDER BY date ASC
  `;

  const params: (string | null)[] = [from, to, ward, ward];

  const stmt = context.env.DB.prepare(sql);
  const result = await stmt
    .bind(...params)
    .all<{ date: string; ward: string; admissions: number; discharges: number; avg_los: number }>();

  const suppressed = (result.results || []).map((row) => ({
    ...row,
    // Small cell suppression for counts < 5
    admissions: row.admissions < 5 ? "<5" : row.admissions,
    discharges: row.discharges < 5 ? "<5" : row.discharges,
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

