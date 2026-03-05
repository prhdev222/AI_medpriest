/// <reference types="@cloudflare/workers-types" />

type Env = {
  DB: D1Database;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  ADMIN_PIN?: string;
  SITE_PIN?: string;
  TURSO_HTTP_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

interface ChatRequestBody {
  question?: string;
  // optional, only used when admin PIN matches
  tempApiKey?: string;
  tempModel?: string;
  adminPin?: string;
  sitePin?: string;
}

// POST /api/chat?from=YYYY-MM-DD&to=YYYY-MM-DD&ward=MED
// This function:
// 1. Reads the natural-language question
// 2. Fetches aggregated metrics from D1 (analytics tables only)
// 3. Sends only aggregated JSON to OpenRouter
// 4. Returns the AI explanation text
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const ward = url.searchParams.get("ward");

  let body: ChatRequestBody;
  try {
    body = (await context.request.json()) as ChatRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const question = (body.question || "").trim();
  if (!question) {
    return json({ error: "question is required" }, 400);
  }

  // Basic site access PIN (ไม่เกี่ยวกับ admin override)
  const sitePinOk = await validateSitePin(context.env, (body.sitePin || "").trim());
  if (!sitePinOk) {
    return json({ error: "invalid_site_pin" }, 401);
  }

  const providedPin = (body.adminPin || "").trim();
  const hasAdminPinEnv = !!context.env.ADMIN_PIN;
  const adminOverrideAllowed =
    hasAdminPinEnv && providedPin.length > 0 && providedPin === context.env.ADMIN_PIN;

  // Basic PHI / identifiable query guardrail
  const lower = question.toLowerCase();
  const forbiddenKeywords = ["hn", "hospital number", "ชื่อคนไข้", "เลขบัตร", "id "];
  if (forbiddenKeywords.some((k) => lower.includes(k))) {
    return json({
      answer:
        "ระบบนี้ออกแบบให้เป็น analytics แบบรวมข้อมูลเท่านั้น ไม่สามารถตอบคำถามที่ระบุตัวบุคคล หรืออ้างอิงถึง HN/ข้อมูล PHI ได้ค่ะ",
    });
  }

  // Log successful chat usage event (เฉพาะคำถามที่ไม่ละเมิด PHI guardrail)
  try {
    await logUsageEvent(context.env, "chat");
  } catch (err) {
    console.error("usage log (chat) error", err);
  }

  // Fetch aggregated metrics to provide as context (read-only; never reads HN)
  // ถ้า local D1 ยังไม่มี schema จะตอบแบบอธิบายให้ตั้งค่าแทนการ throw 500
  let metricsContext: unknown;
  try {
    metricsContext = await fetchAggregatedMetrics(context.env.DB, {
      from,
      to,
      ward,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("D1 metrics error", msg);
    const isMissingTable =
      msg.includes("no such table") || msg.includes("D1_ERROR") || msg.includes("SQLITE_ERROR");

    return json({
      answer: isMissingTable
        ? "ตอนนี้ D1 ที่ใช้กับ dev server ยังไม่มีตาราง `ipd_stays`/`discharge_plans` เลยทำให้ query ไม่ได้ค่ะ ถ้าต้องการอ่าน D1 ตัวจริงบน Cloudflare ให้รัน `wrangler pages dev . --remote` หรือถ้าจะใช้ local D1 ให้สร้าง schema ใน local ก่อน แล้วค่อยรันใหม่ค่ะ"
        : "ไม่สามารถอ่านข้อมูลจาก D1 ได้ในขณะนี้ค่ะ โปรดตรวจสอบการ bind DB และ schema ของตาราง แล้วลองใหม่อีกครั้ง",
    });
  }

  // If OpenRouter is not configured, fail gracefully but do not expose raw data
  const apiKeyToUse =
    adminOverrideAllowed && body.tempApiKey && body.tempApiKey.trim().length > 0
      ? body.tempApiKey.trim()
      : context.env.OPENROUTER_API_KEY;

  if (!apiKeyToUse) {
    return json({
      answer:
        "Backend ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY จึงไม่สามารถเรียก AI ได้ แต่ metrics aggregation ทำงานตามปกติแล้วค่ะ",
    });
  }

  const systemPrompt = buildSystemPrompt(metricsContext);

  const model =
    (adminOverrideAllowed && body.tempModel && body.tempModel.trim().length > 0
      ? body.tempModel.trim()
      : context.env.OPENROUTER_MODEL && context.env.OPENROUTER_MODEL.trim().length > 0
        ? context.env.OPENROUTER_MODEL.trim()
        : "mistralai/mistral-small-3.1-24b-instruct:free");

  const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKeyToUse}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: question,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!completion.ok) {
    console.error("OpenRouter error", completion.status, await completion.text());
    return json({
      answer:
        "ระบบไม่สามารถเชื่อมต่อกับ OpenRouter ได้ในขณะนี้ แต่ metrics backend ยังทำงานได้ตามปกติค่ะ",
    });
  }

  const data = (await completion.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const answer =
    data.choices?.[0]?.message?.content?.trim() ||
    "ระบบไม่สามารถสร้างคำอธิบายได้ในตอนนี้ค่ะ";

  return json({ answer });
};

async function logUsageEvent(env: Env, type: "chat" | "open") {
  try {
    await tursoExecute(
      env,
      "INSERT INTO usage_events (event_type, source) VALUES (?, ?)",
      [type, "web"],
    );
  } catch (err) {
    console.error("Turso usage log error", err);
  }
}

function tursoArgs(values: (string | number)[]): { type: string; value: string }[] {
  return values.map((v) => ({
    type: typeof v === "number" ? (Number.isInteger(v) ? "integer" : "float") : "text",
    value: String(v),
  }));
}

async function tursoExecute(
  env: Env,
  sql: string,
  args: (string | number)[] = [],
): Promise<any> {
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

async function validateSitePin(env: Env, pin: string): Promise<boolean> {
  // ถ้าไม่มีการตั้งค่า Turso ให้ fallback มาใช้ SITE_PIN env เดิม
  if (!env.TURSO_HTTP_URL || !env.TURSO_AUTH_TOKEN) {
    if (!env.SITE_PIN) return true;
    return pin === env.SITE_PIN;
  }

  if (!pin) return false;

  try {
    const result = await tursoExecute(
      env,
      "SELECT value FROM site_config WHERE key = 'site_pin' LIMIT 1",
    );
    const row = result.response?.rows?.[0];
    const valueCell = row?.values?.[0];
    const storedPin: string | undefined =
      valueCell?.text ?? valueCell?.blob ?? valueCell?.integer?.toString();

    if (!storedPin) {
      // ถ้า DB ยังไม่มีค่า ให้ถือว่าไม่บังคับ PIN
      return true;
    }

    return pin === storedPin;
  } catch (err) {
    console.error("Turso site_pin error", err);
    // ถ้า Turso มีปัญหา ไม่ควรล็อกผู้ใช้ทั้งหมด ให้ fallback เป็นอนุญาตชั่วคราว
    return true;
  }
}

async function fetchAggregatedMetrics(
  db: D1Database,
  params: { from: string | null; to: string | null; ward: string | null },
) {
  const { from, to, ward } = params;

  // Safe defaults: last 30 days if no date provided
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.getTime() - 29 * 86400000)
    .toISOString()
    .slice(0, 10);

  const dateFrom = from || defaultFrom;
  const dateTo = to || defaultTo;

  const wardFilter = ward || null;

  const args: (string | null)[] = [dateFrom, dateTo, wardFilter, wardFilter];

  // อ่าน aggregated metrics แบบ read-only จาก raw tables โดยไม่เลือก hn
  // 1) IPD: จาก ipd_stays
  const ipdSql = `
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
  const ipdStmt = db.prepare(ipdSql);
  const ipd = await ipdStmt.bind(...args).all<{
    date: string;
    ward: string;
    admissions: number;
    discharges: number;
    avg_los: number;
  }>();

  // 1a) IPD ตามประเภทการนอน (stay_type) เพื่อแยก admit vs AO (admit observe)
  const ipdTypeSql = `
    SELECT
      date(admit_date) AS date,
      ward,
      stay_type,
      COUNT(*) AS stays,
      ROUND(AVG(CASE WHEN los > 0 THEN los END), 1) AS avg_los
    FROM ipd_stays
    WHERE admit_date BETWEEN ? AND ?
      AND (? IS NULL OR ward = ?)
    GROUP BY date(admit_date), ward, stay_type
    ORDER BY date ASC, ward ASC, stay_type ASC
  `;
  const ipdTypeStmt = db.prepare(ipdTypeSql);
  const ipdByType = await ipdTypeStmt.bind(...args).all<{
    date: string;
    ward: string;
    stay_type: string;
    stays: number;
    avg_los: number;
  }>();

  // 2) Discharge delay: จาก discharge_plans
  const delaySql = `
    SELECT
      fit_discharge_date AS date,
      ward,
      SUM(CASE WHEN delay_days > 0 THEN 1 ELSE 0 END) AS delayed_cases,
      ROUND(AVG(CASE WHEN delay_days > 0 THEN delay_days END), 1) AS mean_delay_days
    FROM discharge_plans
    WHERE fit_discharge_date BETWEEN ? AND ?
      AND (? IS NULL OR ward = ?
    )
    GROUP BY fit_discharge_date, ward
    ORDER BY date ASC
  `;
  const delayStmt = db.prepare(delaySql);
  const delay = await delayStmt.bind(...args).all<{
    date: string;
    ward: string;
    delayed_cases: number;
    mean_delay_days: number;
  }>();

  // 3) OPD: ตาราง opd (ไม่มี HN)
  const opdSql = `
    SELECT
      date,
      count
    FROM opd
    WHERE date BETWEEN ? AND ?
    ORDER BY date ASC
  `;
  const opdStmt = db.prepare(opdSql);
  const opd = await opdStmt.bind(dateFrom, dateTo).all<{
    date: string;
    count: number;
  }>();

  // 4) ER: ตาราง er (ไม่มี HN)
  const erSql = `
    SELECT
      date,
      count
    FROM er
    WHERE date BETWEEN ? AND ?
    ORDER BY date ASC
  `;
  const erStmt = db.prepare(erSql);
  const er = await erStmt.bind(dateFrom, dateTo).all<{
    date: string;
    count: number;
  }>();

  // 5) Consult: ตาราง consult (ไม่มี HN)
  const consultSql = `
    SELECT
      date,
      count
    FROM consult
    WHERE date BETWEEN ? AND ?
    ORDER BY date ASC
  `;
  const consultStmt = db.prepare(consultSql);
  const consult = await consultStmt.bind(dateFrom, dateTo).all<{
    date: string;
    count: number;
  }>();

  // 6) Procedures: วิเคราะห์ case mix ตามหัตถการ (ไม่มี HN)
  const proceduresSql = `
    SELECT
      date,
      ward,
      procedure_key,
      procedure_label,
      SUM(count) AS total_count
    FROM procedures
    WHERE date BETWEEN ? AND ?
      AND (? IS NULL OR ward = ?)
    GROUP BY date, ward, procedure_key, procedure_label
    ORDER BY date ASC, ward ASC, total_count DESC
  `;
  const proceduresStmt = db.prepare(proceduresSql);
  const procedures = await proceduresStmt.bind(...args).all<{
    date: string;
    ward: string;
    procedure_key: string;
    procedure_label: string;
    total_count: number;
  }>();

  // 7) Ward beds: ความพร้อมเตียงแต่ละ ward (ไม่มี HN)
  const bedsSql = `
    SELECT
      date,
      ward,
      beds
    FROM ward_beds
    WHERE date BETWEEN ? AND ?
      AND (? IS NULL OR ward = ?)
    ORDER BY date ASC, ward ASC
  `;
  const bedsStmt = db.prepare(bedsSql);
  const beds = await bedsStmt.bind(...args).all<{
    date: string;
    ward: string;
    beds: number;
  }>();

  return {
    date_from: dateFrom,
    date_to: dateTo,
    ward: wardFilter,
    ipd_daily_summary: ipd.results || [],
    ipd_staytype_summary: ipdByType.results || [],
    discharge_delay_daily: delay.results || [],
    opd_daily_summary: opd.results || [],
    er_daily_summary: er.results || [],
    consult_daily_summary: consult.results || [],
    procedures_daily_summary: procedures.results || [],
    ward_beds_daily_summary: beds.results || [],
  };
}

function buildSystemPrompt(context: unknown): string {
  return [
    "You are an AI assistant for a hospital operations analytics dashboard called MedPriest Analytics AI.",
    "The user is a clinician or manager. You only receive aggregated, de-identified metrics from analytics tables.",
    "",
    "STRICT PRIVACY RULES:",
    "- You must NEVER request or hallucinate HN (hospital numbers), names, national IDs, or any directly identifiable PHI.",
    "- If the user asks for patient-level, identifiable, or re-identifiable information, you MUST politely refuse and explain that the system is analytics-only.",
    "- Assume that all data you see is already aggregated and non-identifiable.",
    "",
    "IMPORTANT DOMAIN NOTES ABOUT IPD DATA:",
    "- The table ipd_stays contains a column stay_type with values like 'admit' and 'ao'.",
    "- 'admit' means a true inpatient admission with an expected stay > 1 night (or clear inpatient treatment plan).",
    "- 'ao' means 'admit observe': short observation stays (ประมาณ 1 วันแล้วกลับบ้าน ไม่ถือว่าเป็นการนอน รพ. เต็มรูปแบบ).",
    "- When interpreting admissions and LOS, distinguish between full admissions and AO cases where appropriate.",
    "- For high-level operational KPIs like bed occupancy or inpatient workload, focus more on 'admit' than 'ao', but you may mention AO volume separately for context.",
    "",
    "DATA YOU SEE (JSON):",
    JSON.stringify(context, null, 2),
    "",
    "TASK:",
    "- Explain trends, patterns, and anomalies in the metrics in clear clinical Thai language suitable for ward meetings or quality rounds.",
    "- Refer only to wards, dates, and aggregated numbers (for example: admissions, discharges, LOS, delayed discharges).",
    "- Give practical, actionable suggestions for ward operations or quality improvement when appropriate.",
    "- If metrics are sparse or suppressed (for example '<5'), emphasize uncertainty and avoid over-interpretation.",
    "",
    "STYLE (VERY IMPORTANT):",
    "- Answer in Thai.",
    "- Keep the answer SHORT (ประมาณ 3–5 บรรทัด หรือไม่เกิน ~120 คำ).",
    "- ใช้ bullet สั้น ๆ หรือประโยคสั้น ๆ ที่เข้าใจง่ายสำหรับแพทย์และพยาบาล.",
    "- อนุญาตให้ใช้คำย่อที่คุ้นเคยในงานอายุรกรรม (เช่น LOS, admit, d/c, ICU, ER, OPD ฯลฯ) เพื่อประหยัดเนื้อหา แต่ให้คงความชัดเจน.",
    "- หลีกเลี่ยงการเกริ่นนำยาว ๆ หรือสรุปซ้ำหลายรอบ ให้โฟกัสเฉพาะ insight สำคัญและข้อเสนอแนะหลักเท่านั้น.",
  ].join("\n");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

