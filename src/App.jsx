import React, { useState, useRef, useCallback } from "react";

// ============================================================================
// ANALISTA FINANCEIRO ATTENTO — Administradora de Condomínios
// Fluxo: Upload de documentos → Análise contábil (detecção de erros) →
//        Confirmação de correção → Geração de apresentação para assembleia
// Backend: API Anthropic (mesma estrutura do app da Holder)
// ============================================================================

const VERDE = {
  900: "#0B2E1A",
  800: "#0F4429",
  700: "#136B3D",
  600: "#1A8C4F",
  500: "#22A862",
  400: "#4CC585",
  200: "#A7E5C2",
  100: "#D7F4E3",
  50: "#EDFBF3",
};

const ETAPAS = [
  { id: "upload", n: 1, label: "Documentos", icon: "📄" },
  { id: "analise", n: 2, label: "Análise", icon: "🔍" },
  { id: "correcao", n: 3, label: "Correção", icon: "✅" },
  { id: "apresentacao", n: 4, label: "Assembleia", icon: "📊" },
];

const TIPOS_DOC = [
  { key: "balancete", label: "Balancete" },
  { key: "razao", label: "Razão Contábil" },
  { key: "extratos", label: "Extratos Bancários" },
  { key: "nfs", label: "Notas Fiscais" },
  { key: "ata", label: "Ata" },
  { key: "demonstrativo", label: "Demonstrativo" },
];

// --- chamada à API Anthropic (idêntica à estrutura do app da Holder) -------
async function chamarClaude(prompt, arquivosBase64 = []) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, arquivos: arquivosBase64 }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.erro || "Erro ao chamar o analista");
  return data.texto || "";
}

function lerArquivoBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ name: file.name, media_type: file.type, data: r.result.split(",")[1] });
    r.onerror = () => rej(new Error("Falha ao ler arquivo"));
    r.readAsDataURL(file);
  });
}

function parseJSON(texto) {
  if (!texto) return null;
  let limpo = texto.replace(/```json/gi, "").replace(/```/g, "").trim();
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini === -1 || fim === -1 || fim <= ini) return null;
  let bloco = limpo.slice(ini, fim + 1);
  try {
    return JSON.parse(bloco);
  } catch {
    try {
      bloco = bloco.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(bloco);
    } catch {
      return null;
    }
  }
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function mesAtualFormatado() {
  const d = new Date();
  return `${MESES[d.getMonth()]}/${d.getFullYear()}`;
}

// Dado o mês da prestação (ex. "Março/2026"), retorna a competência dos
// documentos = mês anterior (ex. "Fevereiro/2026"). Vira o ano se for Janeiro.
function competenciaDeReferencia(mesPrestacao) {
  if (!mesPrestacao) return "";
  const [nome, ano] = mesPrestacao.split("/").map((s) => s.trim());
  const idx = MESES.findIndex((m) => m.toLowerCase() === (nome || "").toLowerCase());
  if (idx === -1 || !ano) return "";
  const anoNum = parseInt(ano, 10);
  if (idx === 0) return `${MESES[11]}/${anoNum - 1}`;
  return `${MESES[idx - 1]}/${anoNum}`;
}

export default function AnalistaFinanceiroAttento() {
  const [etapa, setEtapa] = useState("upload");
  const [arquivos, setArquivos] = useState([]);
  const [condominio, setCondominio] = useState("");
  const [mesPrestacao, setMesPrestacao] = useState(mesAtualFormatado());
  const competencia = competenciaDeReferencia(mesPrestacao);
  const [carregando, setCarregando] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [analise, setAnalise] = useState(null); // { erros: [], contas: [] }
  const [errosCorrigidos, setErrosCorrigidos] = useState({});
  const [apresentacao, setApresentacao] = useState(null);
  const [erroApi, setErroApi] = useState("");
  // Regras/contexto da Attento que o usuário ensina ao agente (persistem na sessão)
  const [regrasContexto, setRegrasContexto] = useState([]);
  const [chatMsgs, setChatMsgs] = useState([]); // { autor: 'voce'|'agente', texto }
  const [chatInput, setChatInput] = useState("");
  const inputRef = useRef(null);

  const indiceEtapa = ETAPAS.findIndex((e) => e.id === etapa);

  // --- upload ----------------------------------------------------------------
  const handleArquivos = async (files) => {
    const lista = Array.from(files);
    const novos = [];
    for (const f of lista) {
      const b64 = await lerArquivoBase64(f);
      novos.push({ ...b64, tipo: "balancete", size: f.size });
    }
    setArquivos((prev) => [...prev, ...novos]);
  };

  const removerArquivo = (i) => setArquivos((prev) => prev.filter((_, idx) => idx !== i));
  const setTipoArquivo = (i, tipo) =>
    setArquivos((prev) => prev.map((a, idx) => (idx === i ? { ...a, tipo } : a)));

  // --- análise ---------------------------------------------------------------
  const rodarAnalise = async () => {
    setCarregando(true);
    setErroApi("");
    setStatusMsg("Lendo documentos e cruzando lançamentos contábeis...");
    try {
      const regrasTxt = regrasContexto.length
        ? `\nREGRAS ADICIONAIS QUE O USUÁRIO (analista da Attento) ENSINOU — siga à risca, elas têm prioridade:\n${regrasContexto.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n`
        : "";
      const prompt = `Você é um analista contábil de uma administradora de condomínios (Attento).
Analise os documentos do condomínio "${condominio || "—"}", referentes à prestação de contas com pagamentos do mês "${mesPrestacao || "—"}" (regime de caixa — as despesas aparecem pela data de pagamento).
${regrasTxt}
REGIME CONTÁBIL DA ATTENTO — REGIME DE CAIXA (leia antes de apontar qualquer erro):
- Os condomínios usam REGIME DE CAIXA PURO. O que vale é a DATA DE PAGAMENTO, não a data a que a despesa se refere.
- Uma conta paga em março entra na prestação de março, mesmo que o consumo/referência seja de fevereiro. Isso é o CORRETO e esperado.
- NÃO existe provisão neste regime. NUNCA aponte "despesa de competência anterior sem provisão", "despesa lançada no mês errado", "regime de competência" ou qualquer variação disso — esses conceitos NÃO se aplicam aqui e não são erros.
- A diferença entre a data de referência da conta e a data de pagamento é NORMAL e nunca deve aparecer na lista de erros.

O QUE É REALMENTE UM ERRO (só aponte estes casos):
- Lançamento em conta contábil de classificação ERRADA: ex. fatura de água lançada na conta de energia elétrica, ou vice-versa. A conta_errada e a conta_correta DEVEM ser diferentes.
- Valor divergente entre o documento (nota/fatura/extrato) e o valor lançado.
- Despesa duplicada (mesmo documento pago/lançado duas vezes).
- Pagamento sem documento de suporte correspondente.

REGRAS DE SAÍDA:
- NUNCA gere um item de erro onde conta_errada == conta_correta. Se as duas forem iguais, não é erro: não inclua.
- Se não houver nenhum erro real de classificação/valor/duplicidade, retorne "erros": [] (lista vazia). É um resultado válido e esperado.

Tarefa:
1. Identificar APENAS os erros reais descritos acima.
2. Listar TODAS as contas contábeis encontradas com seus saldos.

Responda APENAS com JSON, sem markdown, neste formato exato:
{
  "erros": [
    { "id": 1, "conta_errada": "02.07.01 Energia Elétrica", "conta_correta": "02.07.03 Água/Esgoto", "valor": 1121.76, "descricao": "Fatura da Águas Cuiabá lançada na conta de energia elétrica", "gravidade": "alta" }
  ],
  "contas": [
    { "codigo": "02.07.03", "nome": "Água/Esgoto", "saldo": 1121.76, "tipo": "despesa" }
  ]
}`;
      const resp = await chamarClaude(prompt, arquivos);
      const json = parseJSON(resp);
      if (!json) throw new Error("Não consegui interpretar a resposta da análise. Início da resposta recebida: " + (resp ? resp.slice(0, 200) : "(vazia)"));
      // Proteção: descarta "erros" onde a conta errada e a correta são iguais (não é erro real)
      const norm = (s) => (s || "").trim().toLowerCase();
      const errosReais = (json.erros || []).filter((e) => norm(e.conta_errada) !== norm(e.conta_correta));
      setAnalise({ erros: errosReais, contas: json.contas || [] });
      const inicial = {};
      errosReais.forEach((e) => (inicial[e.id] = false));
      setErrosCorrigidos(inicial);
      setEtapa("analise");
    } catch (err) {
      setErroApi(err.message);
    } finally {
      setCarregando(false);
      setStatusMsg("");
    }
  };

  // --- chat de refinamento: usuário ensina regras e o agente reavalia ---------
  const enviarChat = async () => {
    const msg = chatInput.trim();
    if (!msg || carregando) return;
    setChatInput("");
    setChatMsgs((prev) => [...prev, { autor: "voce", texto: msg }]);
    setCarregando(true);
    setErroApi("");
    setStatusMsg("Reavaliando a análise com sua explicação...");
    try {
      const errosTxt = (analise?.erros || [])
        .map((e) => `- [${e.id}] ${e.descricao} (${e.conta_errada} → ${e.conta_correta}, R$ ${e.valor})`)
        .join("\n") || "(nenhum)";
      const prompt = `Você é o analista contábil da Attento. Você havia identificado estes erros na análise atual:
${errosTxt}

O analista humano te enviou esta observação/correção sobre a análise:
"${msg}"

Tarefas:
1. Se a observação for uma REGRA reutilizável (algo que deve valer pra próximas análises, ex: "X não é erro, é o padrão da Attento"), extraia-a de forma curta e clara.
2. Reavalie a lista de erros considerando a observação. Remova os que não são erros de verdade segundo o que foi explicado; mantenha só os reais.
3. Escreva uma resposta curta e direta pro analista (1-2 frases), em português, confirmando o que entendeu.

Responda APENAS com JSON:
{
  "resposta": "texto curto pro analista",
  "nova_regra": "regra reutilizável extraída, ou string vazia se não houver",
  "erros": [ { "id": 1, "conta_errada": "", "conta_correta": "", "valor": 0, "descricao": "", "gravidade": "" } ]
}`;
      const resp = await chamarClaude(prompt, arquivos);
      const json = parseJSON(resp);
      if (!json) throw new Error("Não consegui interpretar a resposta do chat.");
      const norm = (s) => (s || "").trim().toLowerCase();
      const errosReais = (json.erros || []).filter((e) => norm(e.conta_errada) !== norm(e.conta_correta));
      setAnalise((prev) => ({ ...prev, erros: errosReais }));
      const inicial = {};
      errosReais.forEach((e) => (inicial[e.id] = !!errosCorrigidos[e.id]));
      setErrosCorrigidos(inicial);
      if (json.nova_regra && json.nova_regra.trim()) {
        setRegrasContexto((prev) => [...prev, json.nova_regra.trim()]);
      }
      setChatMsgs((prev) => [...prev, { autor: "agente", texto: json.resposta || "Análise atualizada." }]);
    } catch (err) {
      setChatMsgs((prev) => [...prev, { autor: "agente", texto: "Erro ao reavaliar: " + err.message }]);
    } finally {
      setCarregando(false);
      setStatusMsg("");
    }
  };

  const removerRegra = (i) => setRegrasContexto((prev) => prev.filter((_, idx) => idx !== i));
  const marcarCorrigido = (id) =>
    setErrosCorrigidos((prev) => ({ ...prev, [id]: !prev[id] }));

  const todosCorrigidos =
    analise && analise.erros.length > 0 && analise.erros.every((e) => errosCorrigidos[e.id]);
  const semErros = analise && analise.erros.length === 0;

  const revalidar = async () => {
    setCarregando(true);
    setErroApi("");
    setStatusMsg("Revalidando lançamentos corrigidos...");
    try {
      const errosTxt = analise.erros
        .map((e) => `- ${e.descricao}: deveria estar em "${e.conta_correta}" (R$ ${e.valor})`)
        .join("\n");
      const prompt = `O usuário corrigiu os seguintes erros contábeis do condomínio "${condominio}":
${errosTxt}

Confirme se a correção faz sentido contábil e responda APENAS com JSON:
{ "validado": true, "observacao": "texto curto confirmando que as contas estão corretas" }`;
      const resp = await chamarClaude(prompt, arquivos);
      const json = parseJSON(resp);
      if (json && json.validado) {
        setStatusMsg("");
        setEtapa("correcao");
      } else {
        setErroApi(json?.observacao || "A revalidação não confirmou a correção. Revise os lançamentos.");
      }
    } catch (err) {
      setErroApi(err.message);
    } finally {
      setCarregando(false);
      setStatusMsg("");
    }
  };

  // --- geração da apresentação -----------------------------------------------
  const gerarApresentacao = async () => {
    setCarregando(true);
    setErroApi("");
    setStatusMsg("Montando a apresentação da assembleia...");
    try {
      const contasTxt = analise.contas
        .map((c) => `${c.codigo} ${c.nome}: R$ ${c.saldo} (${c.tipo})`)
        .join("\n");
      const prompt = `Você prepara a prestação de contas de um condomínio para a ASSEMBLEIA, para condôminos LEIGOS (sem conhecimento contábil).
Condomínio: ${condominio} | Prestação de contas: ${mesPrestacao}
Regime de caixa: valores pela DATA DE PAGAMENTO.
Contas contábeis (já revisadas):
${contasTxt}

Tarefa: resuma de forma SIMPLES e CLARA. Agrupe as despesas em CATEGORIAS do dia a dia que qualquer morador entende (ex.: "Água", "Energia", "Limpeza", "Manutenção", "Administração", "Salários/Pessoal", "Outros"). Some os valores de cada categoria. Use linguagem cotidiana, sem jargão contábil, sem códigos de conta.

Responda APENAS com JSON, valores numéricos sem "R$":
{
  "total_entrou": 0,
  "total_saiu": 0,
  "sobrou": 0,
  "resumo": ["1 frase bem simples sobre o mês", "1 frase sobre o que pesou mais"],
  "categorias": [
    { "nome": "Água", "valor": 0, "explicacao": "frase curta do que é, em linguagem de leigo" }
  ]
}
Ordene "categorias" do maior valor para o menor. "sobrou" = total_entrou - total_saiu.`;
      const resp = await chamarClaude(prompt, arquivos);
      const json = parseJSON(resp);
      setApresentacao(json || { total_entrou: 0, total_saiu: 0, sobrou: 0, resumo: [], categorias: [] });
      setEtapa("apresentacao");
    } catch (err) {
      setErroApi(err.message);
    } finally {
      setCarregando(false);
      setStatusMsg("");
    }
  };

  const reiniciar = () => {
    setEtapa("upload");
    setArquivos([]);
    setAnalise(null);
    setApresentacao(null);
    setErrosCorrigidos({});
    setErroApi("");
  };

  const brl = (v) =>
    Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // ===========================================================================
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", color: VERDE[900] }}>
      {/* HEADER */}
      <div style={{ background: VERDE[800], borderRadius: 16, padding: "20px 28px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: VERDE[500], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📈</div>
          <div>
            <div style={{ color: "#fff", fontSize: 19, fontWeight: 600, lineHeight: 1.1 }}>Analista Financeiro Attento</div>
            <div style={{ color: VERDE[200], fontSize: 13 }}>Administradora de Condomínios · Análise contábil + Assembleia</div>
          </div>
        </div>
        <button onClick={reiniciar} style={{ background: "transparent", border: `1px solid ${VERDE[500]}`, color: VERDE[100], borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
          Reiniciar
        </button>
      </div>

      {/* STEPPER */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {ETAPAS.map((e, i) => {
          const ativo = i === indiceEtapa;
          const feito = i < indiceEtapa;
          return (
            <div key={e.id} style={{ flex: 1, background: ativo ? VERDE[500] : feito ? VERDE[100] : "#F4F6F4", border: `1px solid ${ativo ? VERDE[600] : feito ? VERDE[200] : "#E2E6E2"}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: ativo ? "#fff" : feito ? VERDE[500] : "#D6DAD6", color: ativo ? VERDE[700] : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                {feito ? "✓" : e.n}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: ativo ? "#fff" : feito ? VERDE[700] : "#8A938C" }}>{e.label}</span>
            </div>
          );
        })}
      </div>

      {/* ERRO API */}
      {erroApi && (
        <div style={{ background: "#FDECEC", border: "1px solid #F3B4B4", color: "#8C2020", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 14 }}>
          ⚠️ {erroApi}
        </div>
      )}

      {/* LOADING */}
      {carregando && (
        <div style={{ background: VERDE[50], border: `1px solid ${VERDE[200]}`, borderRadius: 10, padding: "14px 18px", marginBottom: 16, fontSize: 14, color: VERDE[700], display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 16, height: 16, border: `2px solid ${VERDE[200]}`, borderTopColor: VERDE[600], borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          {statusMsg}
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* ====================== ETAPA 1: UPLOAD ====================== */}
      {etapa === "upload" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: VERDE[700] }}>Condomínio</label>
              <input value={condominio} onChange={(e) => setCondominio(e.target.value)} placeholder="Ex.: Edifício Atlântico" style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: VERDE[700] }}>Mês da prestação de contas</label>
              <input value={mesPrestacao} onChange={(e) => setMesPrestacao(e.target.value)} placeholder="Ex.: Março/2026" style={inp} />
              <div style={{ fontSize: 12, color: VERDE[600], marginTop: 6, background: VERDE[50], border: `1px solid ${VERDE[100]}`, borderRadius: 8, padding: "6px 10px" }}>
                💰 Regime de caixa — despesas pela data de pagamento. Contas pagas em <strong>{mesPrestacao || "—"}</strong> (referência usual: mês anterior).
              </div>
            </div>
          </div>

          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleArquivos(e.dataTransfer.files); }}
            style={{ border: `2px dashed ${VERDE[400]}`, background: VERDE[50], borderRadius: 14, padding: "40px 20px", textAlign: "center", cursor: "pointer", marginBottom: 16 }}
          >
            <div style={{ fontSize: 34, marginBottom: 8 }}>📥</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: VERDE[700] }}>Arraste ou clique para enviar os documentos</div>
            <div style={{ fontSize: 13, color: "#7A857C", marginTop: 4 }}>Balancete, razão, extratos e notas fiscais (PDF ou imagem)</div>
            <input ref={inputRef} type="file" multiple accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => handleArquivos(e.target.files)} />
          </div>

          {arquivos.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {arquivos.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #E2E6E2", borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>{a.media_type === "application/pdf" ? "📄" : "🖼️"}</span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                  <select value={a.tipo} onChange={(e) => setTipoArquivo(i, e.target.value)} style={{ ...inp, width: 160, marginTop: 0, padding: "6px 8px", fontSize: 13 }}>
                    {TIPOS_DOC.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <button onClick={() => removerArquivo(i)} style={{ background: "transparent", border: "none", color: "#C0392B", cursor: "pointer", fontSize: 18 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <button disabled={arquivos.length === 0 || carregando} onClick={rodarAnalise} style={{ ...btnPrimary, opacity: arquivos.length === 0 ? 0.5 : 1 }}>
            🔍 Analisar documentos
          </button>
        </div>
      )}

      {/* ====================== ETAPA 2: ANÁLISE ====================== */}
      {etapa === "analise" && analise && (
        <div>
          <h3 style={titulo}>Erros identificados</h3>
          {analise.erros.length === 0 ? (
            <div style={{ background: VERDE[50], border: `1px solid ${VERDE[200]}`, borderRadius: 12, padding: 20, color: VERDE[700], fontSize: 14 }}>
              ✅ Nenhum erro de classificação contábil encontrado. Você pode seguir direto para a apresentação.
            </div>
          ) : (
            analise.erros.map((e) => (
              <div key={e.id} style={{ background: "#fff", border: `1px solid ${errosCorrigidos[e.id] ? VERDE[400] : "#F0C8C0"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{e.descricao}</div>
                    <div style={{ fontSize: 13, color: "#6B756D" }}>
                      <span style={{ color: "#C0392B" }}>● {e.conta_errada}</span>{"  →  "}
                      <span style={{ color: VERDE[600] }}>● {e.conta_correta}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#6B756D", marginTop: 2 }}>Valor: {brl(e.valor)} · Gravidade: {e.gravidade}</div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: VERDE[700], cursor: "pointer", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={!!errosCorrigidos[e.id]} onChange={() => marcarCorrigido(e.id)} />
                    Corrigi
                  </label>
                </div>
              </div>
            ))
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            {semErros ? (
              <button onClick={() => setEtapa("correcao")} style={btnPrimary}>Seguir →</button>
            ) : (
              <button disabled={!todosCorrigidos || carregando} onClick={revalidar} style={{ ...btnPrimary, opacity: todosCorrigidos ? 1 : 0.5 }}>
                ✅ Revalidar correções
              </button>
            )}
          </div>

          {/* CHAT DE REFINAMENTO */}
          <div style={{ marginTop: 28, background: "#fff", border: "1px solid #E2E6E2", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ background: VERDE[100], padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>💬</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: VERDE[800] }}>Ajustar análise com o agente</div>
                <div style={{ fontSize: 12, color: VERDE[700] }}>Explique o que não é erro ou regras da Attento. Ele reavalia na hora.</div>
              </div>
            </div>

            {/* regras aprendidas */}
            {regrasContexto.length > 0 && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #EEF1EE" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: VERDE[700], marginBottom: 8 }}>📌 Regras que o agente aprendeu nesta sessão:</div>
                {regrasContexto.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: VERDE[50], border: `1px solid ${VERDE[100]}`, borderRadius: 8, padding: "6px 10px", marginBottom: 6, fontSize: 13, color: "#3F473F" }}>
                    <span style={{ flex: 1 }}>{r}</span>
                    <button onClick={() => removerRegra(i)} style={{ background: "transparent", border: "none", color: "#C0392B", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {/* mensagens */}
            <div style={{ maxHeight: 260, overflowY: "auto", padding: "14px 16px" }}>
              {chatMsgs.length === 0 ? (
                <div style={{ fontSize: 13, color: "#8A938C", textAlign: "center", padding: "10px 0" }}>
                  Ex.: "O item 1 não é erro, manutenção de piscina é mensal e sempre vem nessa conta."
                </div>
              ) : (
                chatMsgs.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.autor === "voce" ? "flex-end" : "flex-start", marginBottom: 10 }}>
                    <div style={{ maxWidth: "80%", background: m.autor === "voce" ? VERDE[500] : "#F1F4F1", color: m.autor === "voce" ? "#fff" : "#2C322C", borderRadius: 12, padding: "8px 12px", fontSize: 13, lineHeight: 1.5 }}>
                      {m.texto}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* input */}
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid #EEF1EE" }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") enviarChat(); }}
                placeholder="Explique o que o agente entendeu errado..."
                disabled={carregando}
                style={{ ...inp, marginTop: 0, flex: 1 }}
              />
              <button onClick={enviarChat} disabled={carregando || !chatInput.trim()} style={{ ...btnPrimary, padding: "10px 18px", opacity: carregando || !chatInput.trim() ? 0.5 : 1 }}>
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================== ETAPA 3: CORREÇÃO OK ====================== */}
      {etapa === "correcao" && analise && (
        <div>
          <div style={{ background: VERDE[50], border: `1px solid ${VERDE[200]}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: VERDE[700], marginBottom: 6 }}>✅ Contas validadas</div>
            <div style={{ fontSize: 14, color: "#5C665E" }}>Os lançamentos foram conferidos e estão corretos. Tudo pronto para gerar a apresentação da assembleia.</div>
          </div>

          <h3 style={titulo}>Todas as contas contábeis</h3>
          <div style={{ background: "#fff", border: "1px solid #E2E6E2", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: VERDE[100] }}>
                  <th style={th}>Código</th><th style={th}>Conta</th><th style={th}>Tipo</th><th style={{ ...th, textAlign: "right" }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {analise.contas.map((c, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #EEF1EE" }}>
                    <td style={td}>{c.codigo}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{c.nome}</td>
                    <td style={td}>{c.tipo}</td>
                    <td style={{ ...td, textAlign: "right" }}>{brl(c.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button disabled={carregando} onClick={gerarApresentacao} style={btnPrimary}>📊 Gerar apresentação da assembleia</button>
        </div>
      )}

      {/* ====================== ETAPA 4: APRESENTAÇÃO ====================== */}
      {etapa === "apresentacao" && apresentacao && (
        <div id="apresentacao-print">
          {/* cabeçalho da prestação */}
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: VERDE[800] }}>Prestação de Contas</div>
            <div style={{ fontSize: 14, color: "#6B756D" }}>{condominio || "Condomínio"} · {mesPrestacao}</div>
          </div>

          {/* ENTROU x SAIU x SOBROU */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {[
              { l: "Entrou", v: apresentacao.total_entrou, c: VERDE[600], icon: "⬆️" },
              { l: "Saiu", v: apresentacao.total_saiu, c: "#C0392B", icon: "⬇️" },
              { l: "Sobrou", v: apresentacao.sobrou, c: (apresentacao.sobrou ?? 0) >= 0 ? VERDE[700] : "#C0392B", icon: "💰" },
            ].map((m, i) => (
              <div key={i} style={{ flex: 1, background: VERDE[50], border: `1px solid ${VERDE[200]}`, borderRadius: 12, padding: "16px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "#6B756D" }}>{m.icon} {m.l}</div>
                <div style={{ fontSize: 23, fontWeight: 700, color: m.c, marginTop: 4 }}>{brl(m.v)}</div>
              </div>
            ))}
          </div>

          {/* resumo em frases simples */}
          {Array.isArray(apresentacao.resumo) && apresentacao.resumo.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #E2E6E2", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 15, color: "#3F473F", lineHeight: 1.7 }}>
                {apresentacao.resumo.map((p, j) => <li key={j}>{p}</li>)}
              </ul>
            </div>
          )}

          {/* PRA ONDE FOI O DINHEIRO — gráfico de barras (torre) */}
          {Array.isArray(apresentacao.categorias) && apresentacao.categorias.length > 0 && (() => {
            const maxV = Math.max(...apresentacao.categorias.map((c) => Number(c.valor) || 0), 1);
            const totalCat = apresentacao.categorias.reduce((s, c) => s + (Number(c.valor) || 0), 0) || 1;
            return (
              <div style={{ background: "#fff", border: "1px solid #E2E6E2", borderRadius: 14, padding: "20px 24px", marginBottom: 16 }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: VERDE[800], marginBottom: 16 }}>Pra onde foi o dinheiro</div>

                {/* gráfico de barras verticais */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 180, marginBottom: 24, paddingTop: 10 }}>
                  {apresentacao.categorias.map((c, i) => {
                    const altura = Math.max(((Number(c.valor) || 0) / maxV) * 150, 4);
                    return (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: VERDE[700], marginBottom: 4 }}>{Math.round((Number(c.valor) || 0) / totalCat * 100)}%</div>
                        <div style={{ width: "100%", maxWidth: 54, height: altura, background: VERDE[500], borderRadius: "6px 6px 0 0" }} title={brl(c.valor)} />
                        <div style={{ fontSize: 11, color: "#6B756D", marginTop: 6, textAlign: "center", lineHeight: 1.2 }}>{c.nome}</div>
                      </div>
                    );
                  })}
                </div>

                {/* lista por categoria */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <tbody>
                    {apresentacao.categorias.map((c, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #EEF1EE" }}>
                        <td style={{ padding: "10px 8px", verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600, color: "#2C322C" }}>{c.nome}</div>
                          {c.explicacao && <div style={{ fontSize: 12.5, color: "#8A938C" }}>{c.explicacao}</div>}
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600, color: VERDE[700], whiteSpace: "nowrap", verticalAlign: "top" }}>{brl(c.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* botões de exportação (escondidos na impressão) */}
          <div className="no-print" style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button onClick={() => window.print()} style={btnPrimary}>📄 Exportar PDF</button>
            <button onClick={() => alert("A exportação em PPTX será gerada no backend (igual ao da Holder). Por enquanto use o PDF.")} style={btnSecondary}>📊 Exportar slides</button>
          </div>
          <style>{`@media print { .no-print { display: none !important; } }`}</style>
        </div>
      )}
    </div>
  );
}

const inp = { width: "100%", marginTop: 4, padding: "9px 12px", borderRadius: 8, border: "1px solid #D6DAD6", fontSize: 14, boxSizing: "border-box" };
const titulo = { fontSize: 17, fontWeight: 600, color: "#0F4429", marginBottom: 12 };
const th = { textAlign: "left", padding: "10px 14px", fontSize: 12, fontWeight: 600, color: "#0F4429" };
const td = { padding: "9px 14px", color: "#3F473F" };
const btnPrimary = { background: "#1A8C4F", color: "#fff", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const btnSecondary = { background: "#fff", color: "#136B3D", border: "1px solid #1A8C4F", borderRadius: 10, padding: "12px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer" };
