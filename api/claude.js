// ============================================================================
//  /api/claude  —  Função serverless (Vercel)
//  Recebe { prompt, arquivos } do front, chama a API da Anthropic com a chave
//  guardada em variável de ambiente, e devolve só o texto da resposta.
//  A CHAVE NUNCA VAI PRO FRONT.
// ============================================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Use POST" });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ erro: "ANTHROPIC_API_KEY não configurada no Vercel" });
  }

  // só aceita chamadas vindas do próprio site (evita uso da chave por terceiros)
  const origem = req.headers.origin;
  if (origem) {
    let hostOrigem = "";
    try { hostOrigem = new URL(origem).host; } catch {}
    if (hostOrigem !== req.headers.host) {
      return res.status(403).json({ erro: "Origem não permitida" });
    }
  }

  try {
    const { prompt, arquivos = [] } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ erro: "Prompt ausente" });
    }

    // monta o content com documentos/imagens + texto
    const content = [];
    for (const a of arquivos) {
      if (a.media_type === "application/pdf") {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: a.data },
        });
      } else if (a.media_type && a.media_type.startsWith("image/")) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: a.media_type, data: a.data },
        });
      }
    }
    content.push({ type: "text", text: prompt });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 20000,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ erro: data?.error?.message || "Erro na API Anthropic" });
    }

    const texto = (data.content || [])
      .filter((i) => i.type === "text")
      .map((i) => i.text)
      .join("\n");

    // cortada = a resposta bateu no max_tokens e o JSON veio incompleto
    return res.status(200).json({ texto, cortada: data.stop_reason === "max_tokens" });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
