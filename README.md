# AI DevOS

Orquestador multi-agente sobre Discord. Cada hilo de Discord es una tarea (feature, bug, PR), y varios agentes con roles distintos actúan sobre ella con el contexto de la organización, del proyecto y del propio hilo.

Proyecto personal y experimental. No está pensado para producción.

## Cómo funciona

1. El **gateway** de Discord escucha eventos y los reenvía al orquestador. No contiene lógica de negocio.
2. El **orquestador** (event-driven) carga el contexto de organización, proyecto e hilo, y decide qué agentes actúan y en qué orden.
3. Los **agentes** (coordinador, arquitecto, planificador, desarrollador, revisor, QA, DevOps y memoria) se ejecutan contra un LLM con prompts construidos a partir de ese contexto.
4. El **agente de memoria** guarda en PostgreSQL las decisiones, patrones y errores, para usarlos en tareas posteriores.
5. Un **router de modelos** elige el modelo según la complejidad de la tarea (opcional).

| Carpeta de `src/` | Qué contiene |
|---|---|
| `gateway`, `adapters` | Discord, Slack, Telegram y webhook |
| `orchestrator`, `agents` | Enrutado de eventos y roles de los agentes |
| `model-router` | Selección de modelo por complejidad |
| `review` | Revisión de código síncrona por HTTP (`POST /api/review`) |
| `github`, `ingestion` | Integración con GitHub y GitLab, e ingesta de repositorios |
| `persistence` | Drizzle ORM sobre PostgreSQL, y Redis |
| `api` | API REST (`/api/status`, `/api/agents`, `/api/review`, `/api/ask`) |

Las especificaciones (requisitos, diseño y tareas) están en `.kiro/specs/`.

## Arranque

Requisitos: Node 22. Copia `.env.example` a `.env` y rellena los valores. Nunca subas `.env`.

```bash
npm install
npm run dev:api   # solo la API REST: basta con un proveedor LLM (Groq, Anthropic, OpenAI u Ollama)
npm run dev       # modo completo: además Discord, PostgreSQL y Redis
npm test          # tests con Vitest
```

Si `API_HOST` no es `127.0.0.1`, la API exige `Authorization: Bearer <WEBHOOK_API_KEY>`.

## Stack

TypeScript, Node.js, discord.js, Drizzle ORM, PostgreSQL, Redis y Vitest.
