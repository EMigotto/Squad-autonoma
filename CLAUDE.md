# CLAUDE.md

Instruções para o assistente de IA ao gerar código neste projeto.

---

## Regras SonarQube — obrigatórias

O pipeline de CI/CD bloqueia o build se estas regras forem violadas.
**Sempre gere código seguindo estas 3 regras.**

---

### Regra 1 — Brace style (S121)

A chave de abertura `{` **deve estar na mesma linha** que o comando de controle (`if`, `else`, `for`, `while`, `try`, `catch`).

```typescript
// ✅ Correto
if (condicao) {
  fazerAlgo();
} else {
  fazerOutraCoisa();
}

for (const item of lista) {
  processar(item);
}

// ❌ Errado
if (condicao)
{
  fazerAlgo();
}
```

---

### Regra 2 — Strings duplicadas (S1192)

Se a mesma string literal aparece **3 ou mais vezes** no mesmo arquivo, extraia para uma `const` no topo do arquivo.

```typescript
// ✅ Correto
const STATUS_APROVADO = "aprovado";

if (card.status === STATUS_APROVADO) { ... }
if (gate.result === STATUS_APROVADO) { ... }
if (review.outcome === STATUS_APROVADO) { ... }

// ❌ Errado
if (card.status === "aprovado") { ... }
if (gate.result === "aprovado") { ... }
if (review.outcome === "aprovado") { ... }
```

---

### Regra 3 — Complexidade cognitiva (S3776, limite 13)

Cada função ou componente tem limite de complexidade **13**. Cada `if`, `for`, `while`, `switch`, `catch`, operador `&&`/`||`, e ternário aninhado incrementa esse contador.

**Regra de ouro: extraia lógica condicional para funções standalone FORA do componente.**

```typescript
// ✅ Correto — função externa reduz a complexidade do componente
function getStatusLabel(status: string, count: number): string {
  if (status !== "ativo") { return "inativo"; }
  return count > 0 ? "tem itens" : "vazio";
}

function MeuComponente({ status, count }: Props) {
  const label = getStatusLabel(status, count); // sem complexidade aqui
  return <span>{label}</span>;
}

// ❌ Errado — const dentro do componente NÃO reduz complexidade
function MeuComponente({ status, count }: Props) {
  // ainda conta para a complexidade do componente
  const label = status !== "ativo"
    ? "inativo"
    : count > 0 ? "tem itens" : "vazio";
  return <span>{label}</span>;
}
```

**Atenção ao ternário aninhado:** `a ? (b ? c : d) : e` custa **+3 pontos** de complexidade (não +1).
Sempre que houver um ternário dentro de outro, mova para uma função externa.

---

## Checklist antes de finalizar um componente

- [ ] Todas as chaves `{` abrem na mesma linha do `if`/`for`/`while`
- [ ] Nenhuma string literal se repete 3+ vezes no arquivo
- [ ] Nenhum componente ou função ultrapassa complexidade 13
- [ ] Lógica condicional complexa está em funções externas, não inline no JSX

---

## Verificar localmente

```bash
npm run lint:sonar
```

Resultado esperado: **0 errors, 0 warnings**.

Para corrigir brace style automaticamente:

```bash
npx eslint app components lib --fix
```
