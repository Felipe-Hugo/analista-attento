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

  try {
    const { prompt, arquivos = [] } = req.body;

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
        max_tokens: 8000,
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

    return res.status(200).json({ texto });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
