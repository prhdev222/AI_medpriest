/// <reference types="@cloudflare/workers-types" />

type Env = {
  TURSO_HTTP_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

// POST /api/usage/log-open
// ใช้ log ว่ามีการเปิดหน้าเว็บหลัก 1 ครั้ง (ไม่เก็บ PHI ใด ๆ)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.TURSO_HTTP_URL || !context.env.TURSO_AUTH_TOKEN) {
      // ถ้าไม่ได้ตั้งค่า Turso ก็ถือว่าไม่เป็นไร ให้ผ่านไปเฉย ๆ
      return new Response("turso not configured", { status: 200 });
    }

    await tursoExecute(
      context.env,
      "INSERT INTO usage_events (event_type, source) VALUES (?, ?)",
      ["open", "web"],
    );
  } catch (err) {
    console.error("log-open error", err);
  }

  return new Response("ok", { status: 200 });
};

async function tursoExecute(env: Env, sql: string, args: (string | number)[] = []) {
  if (!env.TURSO_HTTP_URL || !env.TURSO_AUTH_TOKEN) {
    throw new Error("Turso not configured");
  }

  const res = await fetch(env.TURSO_HTTP_URL.replace(/\/$/, "") + "/v2/pipeline", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: { sql, args },
        },
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

