// ============================================================================
//  /api/ping  —  Função serverless (Vercel)
//  Chamada todo dia pelo cron da Vercel (ver vercel.json) para gerar atividade
//  no Supabase e evitar a pausa automática do plano grátis (7 dias sem uso).
//  Também serve de verificação de saúde: retorna 200 se o banco respondeu.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON } from "../src/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Use GET" });
  }

  const inicio = Date.now();
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/analises?select=id&limit=1`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (!r.ok) {
      return res.status(503).json({ ok: false, erro: `Banco respondeu ${r.status}` });
    }
    return res.status(200).json({
      ok: true,
      banco: "online",
      latenciaMs: Date.now() - inicio,
      em: new Date().toISOString(),
    });
  } catch (e) {
    // fetch falhando aqui normalmente significa projeto pausado (o DNS some)
    return res.status(503).json({ ok: false, erro: `Banco indisponível (pausado?): ${e.message}` });
  }
}
