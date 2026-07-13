async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hands (
      name TEXT PRIMARY KEY
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      hand_name TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      date TEXT
    )`),
  ]);
}

function isAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return Boolean(env.APP_PASSWORD) && token === env.APP_PASSWORD;
}

async function handleGet(env) {
  const [handsRows, entryRows] = await Promise.all([
    env.DB.prepare("SELECT name FROM hands").all(),
    env.DB.prepare("SELECT id, hand_name, amount, note, date FROM entries").all(),
  ]);
  const hands = {};
  for (const row of handsRows.results) hands[row.name] = { name: row.name, entries: [] };
  for (const row of entryRows.results) {
    if (!hands[row.hand_name]) hands[row.hand_name] = { name: row.hand_name, entries: [] };
    hands[row.hand_name].entries.push({ id: row.id, amount: row.amount, note: row.note || "", date: row.date });
  }
  return Response.json(hands);
}

async function handlePost(request, env) {
  const hands = await request.json();
  const stmts = [env.DB.prepare("DELETE FROM entries"), env.DB.prepare("DELETE FROM hands")];
  for (const [name, h] of Object.entries(hands)) {
    stmts.push(env.DB.prepare("INSERT INTO hands (name) VALUES (?)").bind(name));
    for (const e of h.entries || []) {
      stmts.push(
        env.DB.prepare("INSERT INTO entries (id, hand_name, amount, note, date) VALUES (?, ?, ?, ?, ?)")
          .bind(e.id, name, e.amount, e.note || "", e.date || null)
      );
    }
  }
  const CHUNK = 100;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await env.DB.batch(stmts.slice(i, i + CHUNK));
  }
  return Response.json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/hands") {
      await ensureSchema(env.DB);

      if (request.method === "GET") return handleGet(env);
      if (request.method === "POST") {
        if (!isAuthorized(request, env)) {
          return new Response("Unauthorized", { status: 401 });
        }
        return handlePost(request, env);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    return env.ASSETS.fetch(request);
  },
};
