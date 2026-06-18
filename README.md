# Analista Financeiro Attento

App de análise contábil para condomínios (regime de caixa) + geração de prestação de contas para assembleia.

## Como funciona
- **Front (React/Vite):** interface de upload, análise, chat de regras e apresentação.
- **Backend (`/api/claude`):** função serverless do Vercel que chama a API da Anthropic. A chave fica só aqui, nunca no navegador.

---

## Passo a passo do deploy (GitHub → Vercel)

### 1. Subir pro GitHub
No terminal, dentro da pasta `analista-attento`:

```bash
git init
git add .
git commit -m "Analista Attento - primeira versao"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/analista-attento.git
git push -u origin main
```

(Crie o repositório vazio no GitHub antes, sem README, e cole a URL no lugar de `SEU_USUARIO`.)

### 2. Conectar no Vercel
1. Entre em vercel.com → **Add New → Project**.
2. Importe o repositório `analista-attento`.
3. O Vercel detecta Vite automaticamente. Não precisa mudar nada em Build/Output.

### 3. Configurar a chave da Anthropic (IMPORTANTE)
Ainda na tela de import, ou depois em **Settings → Environment Variables**:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | sua chave `sk-ant-...` |

> A chave fica só no servidor do Vercel. Nunca coloque ela no código nem no front.

### 4. Deploy
Clique em **Deploy**. Em ~1 min o site sobe numa URL tipo
`https://analista-attento.vercel.app`.

### 5. Atualizações futuras
Toda vez que você der `git push`, o Vercel republica sozinho.

---

## Rodar localmente (opcional)
```bash
npm install
npm run dev
```
Para testar a função `/api/claude` localmente, use o Vercel CLI: `npx vercel dev` (e crie um arquivo `.env` com `ANTHROPIC_API_KEY=...`).

## Próximos passos
- Integração com a API da Winker (ler documentos direto do sistema, sem upload).
- Exportação em PPTX no backend.
