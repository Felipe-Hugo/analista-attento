// ============================================================================
//  supabase.js — registro e consulta das análises feitas (relatório de controle)
//  Usa a API REST do Supabase com a chave pública (anon). A tabela "analises"
//  tem policy de acesso liberado só pra ela.
// ============================================================================

const SUPABASE_URL = "https://iggjdevyzqdzegukqsuv.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnZ2pkZXZ5enFkemVndWtxc3V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzODM4ODIsImV4cCI6MjEwMTk1OTg4Mn0.neVXObgp_GeMXeGRp4VGuzuEfQcKjesDZkhBYcnVBZQ";

const REST = `${SUPABASE_URL}/rest/v1/analises`;
const headers = {
  "Content-Type": "application/json",
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
};

// registra uma análise feita (chamado automaticamente ao rodar cada análise)
export async function registrarAnalise({ condominio, periodo, tipo_analise, gestora }) {
  try {
    if (!condominio) return; // não registra sem condomínio
    await fetch(REST, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ condominio, periodo, tipo_analise, gestora }),
    });
  } catch (e) {
    // registro é best-effort: se falhar, não atrapalha a análise
    console.error("Falha ao registrar análise:", e);
  }
}

// lista as análises feitas, mais recentes primeiro
export async function listarAnalises() {
  const r = await fetch(`${REST}?select=*&order=criado_em.desc`, { headers });
  if (!r.ok) throw new Error("Não consegui carregar o relatório.");
  return r.json();
}
