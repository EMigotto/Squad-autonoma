# Squad Autônomo — Setup e Deploy

Aplicação Next.js 14 + Supabase + Anthropic Managed Agents pra orquestrar um squad de engenharia onde agentes Claude trabalham em pair-programming com humanos especialistas via Kanban visual.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind |
| Auth + DB + Realtime | Supabase |
| Agentes | Anthropic Managed Agents (beta) |
| Código | GitHub (via MCP) |
| Hospedagem | Vercel |

## Arquitetura

```
[Humanos] → [Kanban Next.js] → [Supabase: DB + Auth + Realtime]
                  ↓
            [API routes do Next] → [Managed Agents do Claude]
                  ↑                         ↓
                  └─── webhook ─────────────┘
                                            ↓
                                      [GitHub via MCP]
```

A UI lê o Supabase com Realtime (sem polling). As API routes do Next chamam o Claude. Quando o agente termina, o Claude bate no webhook, que escreve no Supabase, que dispara o Realtime, que atualiza a UI.

---

## Pré-requisitos

- Node 20+
- Conta na **Anthropic** com acesso à beta de Managed Agents
- Conta no **Supabase** (free tier serve)
- Conta no **Vercel**
- Conta no **GitHub** com um repo onde os agentes vão trabalhar

---

## Passo 1 — Criar o projeto Supabase

1. Em https://supabase.com/dashboard, clica **New project**.
2. Nome livre. Anota a database password.
3. Escolhe região mais próxima (`sa-east-1` se você está no Brasil).
4. Aguarda ~2min até o projeto subir.

Quando estiver pronto, anota essas três coisas (vai precisar):

- **Project Settings → API → Project URL** (algo como `https://xxxxx.supabase.co`)
- **Project Settings → API → anon public key**
- **Project Settings → API → service_role key** ⚠️ (segredo, nunca exponha no client)

### Rodar o schema

1. Abre **SQL Editor** no menu lateral do Supabase.
2. Cola o conteúdo de `supabase/schema.sql`.
3. Clica **Run**. Deve criar todas as tabelas + RLS + Realtime publication.

### Habilitar magic link auth

1. Vai em **Authentication → Providers → Email**.
2. Mantém **Enable Email provider** ligado.
3. Desabilita **Confirm email** (pra magic link funcionar direto no dev).
4. Em **Authentication → URL Configuration**:
   - **Site URL**: a URL de produção do Vercel (você vai voltar e ajustar depois)
   - **Redirect URLs**: adiciona `http://localhost:3000/auth/callback` e depois `https://seu-app.vercel.app/auth/callback`

---

## Passo 2 — Conseguir as chaves Anthropic e GitHub

### Anthropic

1. https://console.anthropic.com → **API Keys** → cria uma key.
2. Em **Settings → Webhooks**, cria um webhook (você volta a configurar a URL depois do deploy).

### GitHub

1. https://github.com/settings/tokens → **Generate new token (classic)**.
2. Scopes: `repo` (full), `workflow`. Anota o token (começa com `ghp_`).

---

## Passo 3 — Rodar local (opcional, recomendado pra validar)

```bash
# Na raiz do projeto
cp .env.example .env.local
# Preencha .env.local com as chaves dos passos 1 e 2

npm install
npm run setup-agents    # cria os agents no Claude
npm run dev             # http://localhost:3000
```

`setup-agents` é idempotente. Se já rodou e nada mudou, é no-op. Quando você editar prompts em `lib/agents.ts`, rode de novo.

Acessa http://localhost:3000, entra com seu email (magic link), e vê o board vazio.

---

## Passo 4 — Deploy no Vercel

### 4.1 Sobe pra um repo Git

```bash
git init
git add .
git commit -m "initial squad autonomo"
git remote add origin git@github.com:SEU_USER/squad-autonomo.git
git push -u origin main
```

### 4.2 Importa no Vercel

1. https://vercel.com/new → escolhe o repo.
2. **Framework Preset**: Next.js (auto-detectado).
3. **Environment Variables**: cola todas as variáveis do `.env.example` com seus valores reais:

   ```
   ANTHROPIC_API_KEY
   ANTHROPIC_WEBHOOK_SIGNING_KEY       (volta depois pra preencher)
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   GITHUB_TOKEN
   NEXT_PUBLIC_APP_URL                 (https://seu-projeto.vercel.app)
   ```

4. Clica **Deploy**. Aguarda ~2min.
5. Vercel te dá uma URL tipo `https://squad-autonomo-xxx.vercel.app`.

### 4.3 Volta no Supabase e ajusta as URLs

Em **Authentication → URL Configuration**:
- **Site URL**: `https://squad-autonomo-xxx.vercel.app`
- **Redirect URLs**: adiciona `https://squad-autonomo-xxx.vercel.app/auth/callback`

### 4.4 Registra o webhook no Anthropic Console

1. https://console.anthropic.com → **Settings → Webhooks**.
2. Cria um webhook apontando pra `https://squad-autonomo-xxx.vercel.app/api/webhook/claude`.
3. Event types: marca pelo menos
   - `session.status_idled`
   - `session.outcome_evaluation_ended`
4. Copia o **signing key** (`whsec_...`) — ele aparece **uma única vez**.
5. Volta no Vercel → **Settings → Environment Variables** → adiciona `ANTHROPIC_WEBHOOK_SIGNING_KEY=whsec_...`.
6. **Redeploy** (Vercel re-builda automaticamente quando você muda env var).

### 4.5 Rodar setup-agents em produção

Pra criar os agents no Claude vinculados ao seu projeto, rode localmente apontando pras envs de produção:

```bash
# Local, com .env.local apontando pro Supabase de produção
npm run setup-agents
```

Isso cria os Agents na sua conta Anthropic e persiste o mapping no Supabase. Como Agents são versionados na conta, não no ambiente, basta uma vez.

---

## Passo 5 — Configurar usuários

Por padrão, novos signups recebem role `pm`. Pra ter quem aprove cada gate, você precisa de pelo menos 3 usuários (um PM, um Tech Lead, um QA).

Convida os 3 emails (via magic link) e depois ajusta os roles direto no Supabase:

```sql
-- Supabase SQL Editor
UPDATE user_profiles SET role = 'tech_lead' WHERE name = 'João';
UPDATE user_profiles SET role = 'qa'        WHERE name = 'Maria';
```

---

## Passo 6 — Smoke test: criar a primeira feature

1. Abre o app em produção e faz login.
2. Clica em **+ nova feature**.
3. Preenche:
   - slug: `dark-mode-toggle`
   - título: `Toggle de dark mode no header`
   - descrição: `Usuário pode alternar entre claro/escuro. Salva preferência por usuário.`
   - github repo: `seu-user/seu-repo` (precisa existir e seu GITHUB_TOKEN ter acesso)
4. Clica **criar e disparar PM Agent →**.

O que vai acontecer:
- Um card aparece na coluna **Discovery** com status `agente trabalhando`.
- Em segundos a Anthropic dispara o PM Agent que clona o repo, escreve PRD/ACs/protótipo, abre um PR draft.
- Quando o agente termina, o webhook chega na sua app, status muda pra `aguarda revisão`, e o card pisca pra você revisar.
- Você abre o PR no GitHub, valida, volta no board e **arrasta o card pra coluna Planning** = aprova.
- Modal pede confirmação; ao aprovar, o Tech Lead Agent é disparado e o card vai pra coluna Planning.
- Rejeitar é arrastar pra esquerda (mesma coluna anterior) → modal pede motivo → card volta pra `agente trabalhando` com a feedback no contexto.

---

## Como funciona a interação UI ↔ pipeline

| Ação no Kanban | O que acontece |
|---|---|
| **+ nova feature** | Cria feature + card em Discovery + dispara session do PM Agent |
| **Drag → direita** | Aprova o gate aberto. Dispara session do próximo agente |
| **Drag ← esquerda** | Abre modal pedindo motivo. Rejeita e re-dispara mesmo agente com feedback |
| **Card pisca (borda amarela)** | Tem um gate aberto pra você decidir |
| **Status "agente trabalhando"** | Session ativa, espera o webhook |
| **Status "aprovado"** | Card congelado, próximo card já avançou |

A UI atualiza em tempo real via Supabase Realtime — você não precisa dar refresh. Quando um colega aprova um card, ele se move no seu navegador automaticamente.

---

## Estrutura do projeto

```
squad-app/
├── app/
│   ├── api/
│   │   ├── webhook/claude/route.ts    ← recebe eventos do Claude
│   │   ├── features/route.ts          ← POST /api/features
│   │   └── gates/[id]/decide/route.ts ← aprovar/rejeitar
│   ├── auth/callback/route.ts         ← magic link callback
│   ├── login/page.tsx
│   ├── page.tsx                       ← board
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── Board.tsx                      ← drag-and-drop principal
│   ├── Column.tsx
│   ├── FeatureCard.tsx
│   ├── CreateFeatureDialog.tsx
│   └── GateDialog.tsx
├── lib/
│   ├── agents.ts                      ← specs dos 7 agents
│   ├── claude.ts                      ← cliente Anthropic
│   ├── orchestrator.ts                ← startStage, advanceCard, createFeature
│   └── supabase/                      ← client server + browser + types
├── scripts/
│   └── setup-agents.ts                ← npm run setup-agents
├── supabase/
│   └── schema.sql                     ← cola no SQL Editor
├── middleware.ts                      ← protege rotas com auth
├── package.json
└── (configs)
```

---

## Iterar e debugar

### Console da Anthropic
Acesse https://console.anthropic.com → **Managed Agents → Sessions** pra ver:
- timeline de cada session (mensagens, tool calls, tempo, custo)
- traces de erro
- agents versionados

Use isso pra debugar quando um agente fizer algo estranho. **Não** é onde os usuários do squad acessam — o Kanban é a interface deles.

### Logs do Vercel
**Functions → Logs** pra ver erros do webhook handler.

### Logs do Supabase
**Database → Logs** pra ver queries lentas ou erros de RLS.

---

## Gotchas comuns

**Webhook retornando 400 (invalid signature).** Verifique se `ANTHROPIC_WEBHOOK_SIGNING_KEY` está correto e o webhook foi criado APÓS você ter a URL do Vercel. O signing key é específico pro endpoint.

**Magic link redireciona pra localhost mesmo em produção.** Você esqueceu de adicionar a URL do Vercel em **Authentication → URL Configuration → Redirect URLs** no Supabase.

**`no current agent for role=pm`.** Você não rodou `npm run setup-agents`. Roda agora com `.env.local` apontando pro Supabase de produção.

**Card não pode ser arrastado.** Por design, só cards em `awaiting_review` (status amarelo) podem mover de coluna. Se o agente ainda está trabalhando (status azul) ou aprovado (verde), drag é desabilitado.

**Vercel timeout em advance_card.** A função `advanceCard` chama `sessions.create` no Claude, que pode levar alguns segundos. O `maxDuration = 60` na route handler resolve. Em produção pesada, considere mover pra fila (QStash, Inngest).

---

## Próximos passos sugeridos

Não tente fazer tudo de uma vez. Roadmap incremental:

| Semana | Entrega | O que valida |
|---|---|---|
| 1 | PM Agent ponta-a-ponta funcionando | Ciclo spec → review → aprovação |
| 2 | Tech Lead Agent decompondo em sub-issues | Decomposição automática serve |
| 3 | Um Dev Agent + Code Reviewer | PR + revisão antes do humano |
| 4 | Tech Lead coordinator com múltiplos Devs paralelos | Paralelismo real |
| 5 | QA Agent fechando o ciclo | Pipeline completa autônoma |

### Coisas que esse MVP omite (e você vai querer depois)

- **Fila robusta** pra webhook (Inngest ou QStash) em vez de processar inline.
- **Extração de artefatos**: hoje `extractSummary` só pega o texto final; um TODO é caminhar os events e extrair file_writes/PR opens pra popular a tabela `artifacts`.
- **Drill-down de feature**: página `/feature/[id]` mostrando todos os artefatos, chunks, gates históricos.
- **Notificação Slack** quando um gate abre.
- **WIP limits** por coluna pra evitar muitos cards paralelos.
- **Vault da Anthropic** pra GitHub token por feature em vez de env var compartilhada.
- **Métricas**: cycle time, taxa de rejeição por agent, custo por feature.

Boa construção. Qualquer ponto desse roadmap eu posso aprofundar.
