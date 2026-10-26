# Plan de Implementación: AI DevOS (Discord)

## Overview

Implementación incremental de un sistema operativo de desarrollo multi-agente sobre Discord. Cada tarea construye sobre la anterior, empezando por la infraestructura base (tipos, persistencia) y terminando con features avanzados y wiring completo. Stack: TypeScript, discord.js, ioredis, drizzle-orm, pgvector, Claude API (Anthropic), fast-check.

## Tasks

- [x] 1. Setup del proyecto y estructura base
  - [x] 1.1 Inicializar proyecto Node.js con TypeScript
    - Crear `package.json` con dependencias: discord.js, ioredis, drizzle-orm, @anthropic-ai/sdk, pg, fast-check (dev), vitest (dev)
    - Crear `tsconfig.json` con strict mode, ESM, paths aliases
    - Crear estructura de carpetas: `src/gateway/`, `src/orchestrator/`, `src/agents/`, `src/persistence/`, `src/github/`, `src/types/`, `src/config/`
    - _Requirements: Diseño — Decisiones de Diseño Clave §5_

  - [x] 1.2 Definir tipos e interfaces core
    - Crear `src/types/events.ts` con NormalizedEvent, MessagePayload, ThreadPayload, ReactionPayload, SlashCommandPayload, GitHubWebhookPayload
    - Crear `src/types/models.ts` con OrgContext, ProjectContext, ThreadContext, ThreadType, ThreadState, Decision, Artifact, MemoryEntry, SessionData
    - Crear `src/types/agents.ts` con AgentRole, Agent, AgentResult, ExecutionPlan, AgentPromptConfig
    - Crear `src/types/orchestrator.ts` con RoutingDecision, FullContext y las interfaces de sub-componentes (EventRouter, ContextLoader, PromptBuilder, AgentExecutor, ResponseManager)
    - Crear `src/types/persistence.ts` con RedisStore, PostgresStore, VectorStore, VectorMetadata, VectorResult
    - _Requirements: 5.1, 5.6, 5.7, 4.1_

  - [x] 1.3 Crear archivo de configuración centralizado
    - Crear `src/config/index.ts` con variables de entorno: DISCORD_TOKEN, REDIS_URL, DATABASE_URL, ANTHROPIC_API_KEY, GITHUB_TOKEN
    - Incluir constantes: MAX_AGENT_TIMEOUT (60s), AUTO_SUMMARY_THRESHOLD (15), MAX_RETRY_ATTEMPTS (3), DEBATE_MAX_TURNS (4)
    - _Requirements: Diseño — Error Handling_


- [x] 2. Capa de persistencia
  - [x] 2.1 Implementar esquema PostgreSQL con Drizzle ORM
    - Crear `src/persistence/schema.ts` con tablas: organizations, projects, threads, memories, embeddings (pgvector)
    - Definir relaciones, constraints CHECK para type/state, índices (ivfflat para embeddings, idx_threads_channel, idx_memories_thread)
    - Crear migration inicial con `drizzle-kit`
    - _Requirements: 5.1, 5.6, 5.7_

  - [x] 2.2 Implementar PostgresStore
    - Crear `src/persistence/postgres-store.ts` implementando la interfaz PostgresStore
    - Métodos: getOrg, upsertOrg, getProject, upsertProject, getThread, upsertThread, storeMemory, getMemories
    - Crear contexto por defecto con valores vacíos cuando no se encuentra un registro (Error Handling — Orquestador)
    - _Requirements: 5.1, 5.4_

  - [x] 2.3 Implementar RedisStore
    - Crear `src/persistence/redis-store.ts` implementando la interfaz RedisStore
    - Métodos: getThreadState, setThreadState, getActiveSession, setActiveSession, incrementMessageCount
    - Claves Redis: `thread:{threadId}:state`, `thread:{threadId}:session`, `thread:{threadId}:msg_count`
    - _Requirements: 5.2, 5.4_

  - [x] 2.4 Implementar VectorStore con pgvector
    - Crear `src/persistence/vector-store.ts` implementando la interfaz VectorStore
    - Métodos: store (insertar embedding + metadata), query (búsqueda por similitud coseno con topK)
    - Usar tabla `embeddings` con vector(1536)
    - _Requirements: 5.3, 5.5_

  - [x] 2.5 Property test: Persistencia dual consistente (Property 10)
    - **Property 10: Persistencia dual consistente**
    - Generar MemoryEntry aleatorios con fast-check, verificar que se escriben en PostgresStore Y VectorStore
    - Verificar que cambio de estado de thread actualiza Redis Y Postgres
    - **Validates: Requirements 5.4, 5.5, 8.2**

  - [x] 2.6 Unit tests para capa de persistencia
    - Tests para PostgresStore: CRUD de orgs, proyectos, threads, memorias
    - Tests para RedisStore: set/get estado, incremento de contador
    - Tests para VectorStore: store/query de embeddings
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 3. Checkpoint — Persistencia completa
  - Ensure all tests pass, ask the user if questions arise.


- [x] 4. Gateway de Discord
  - [x] 4.1 Implementar bot de Discord y normalización de eventos
    - Crear `src/gateway/discord-bot.ts` implementando la interfaz Gateway (start, stop, sendMessage, createThread)
    - Crear `src/gateway/event-normalizer.ts` con función que transforma eventos de discord.js a NormalizedEvent
    - Soportar eventos: on_thread_create, on_message, on_reaction_add
    - Incluir reconexión automática con backoff exponencial (1s, 2s, 4s, 8s, max 30s)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 4.2 Implementar registro de comandos slash
    - Crear `src/gateway/slash-commands.ts` con registro de los 7 comandos: /ai start, /ai plan, /ai code, /ai review, /ai test, /ai deploy, /ai summary
    - Normalizar comandos slash como NormalizedEvent de tipo 'slash_command'
    - _Requirements: 7.1_

  - [x] 4.3 Implementar handler de webhooks de GitHub
    - Crear `src/gateway/github-webhook-handler.ts` para recibir webhooks de GitHub
    - Normalizar webhooks como NormalizedEvent de tipo 'github_webhook'
    - Implementar retry hasta 3 veces con backoff exponencial en caso de fallo de procesamiento
    - _Requirements: 9.1, 9.5_

  - [x] 4.4 Property test: Normalización de eventos (Property 1)
    - **Property 1: Normalización de eventos preserva estructura completa**
    - Generar eventos Discord aleatorios (message, thread_create, reaction_add) con fast-check
    - Verificar que NormalizedEvent contiene: id, type, guildId, channelId, userId, timestamp y payload correcto
    - **Validates: Requirements 1.1, 1.2**

  - [x] 4.5 Property test: Retry con backoff exponencial (Property 12)
    - **Property 12: Retry con backoff exponencial**
    - Generar secuencias de fallos aleatorios, verificar que delay del intento N > delay del intento N-1
    - Verificar máximo 3 reintentos
    - **Validates: Requirements 9.5**

  - [x] 4.6 Unit tests para Gateway
    - Tests para normalización de cada tipo de evento
    - Tests para reconexión automática
    - Tests para los 7 comandos slash registrados
    - Smoke test: 3 eventos soportados, 7 comandos registrados
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.1_

- [x] 5. Checkpoint — Gateway funcional
  - Ensure all tests pass, ask the user if questions arise.


- [x] 6. Sistema de agentes
  - [x] 6.1 Implementar interfaz común de agentes y factory
    - Crear `src/agents/base-agent.ts` con clase base que implementa la interfaz Agent
    - Crear `src/agents/agent-factory.ts` que instancia agentes por rol
    - Integrar con Claude API (Anthropic SDK) para ejecución de prompts
    - Incluir timeout de 60s y manejo de errores (retry 1 vez en respuesta inválida)
    - _Requirements: 4.1, Diseño — Error Handling LLM_

  - [x] 6.2 Implementar prompts de rol para los 8 agentes
    - Crear `src/agents/prompts/` con un archivo por agente: coordinator.ts, architect.ts, planner.ts, developer.ts, reviewer.ts, qa.ts, devops.ts, memory.ts
    - Cada prompt incluye: rol, responsabilidades, reglas de output y formato esperado
    - _Requirements: 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12_

  - [x] 6.3 Implementar Coordinator Agent
    - Crear `src/agents/coordinator-agent.ts` que devuelve ExecutionPlan
    - Lógica de routing: hilo nuevo → [architect, planner]; implementación → developer; código existente → [reviewer, qa]; aprobado → devops
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [x] 6.4 Implementar Memory Agent
    - Crear `src/agents/memory-agent.ts` que extrae decisiones, patrones y errores
    - Output como JSON estructurado (MemoryEntry)
    - Persistir en PostgresStore y VectorStore (dual-write)
    - _Requirements: 4.12, 5.5_

  - [x] 6.5 Implementar los 6 agentes restantes
    - Crear `src/agents/architect-agent.ts` — output: overview, componentes, flujo de datos, riesgos
    - Crear `src/agents/planner-agent.ts` — output: tareas, dependencias, edge cases, complejidad
    - Crear `src/agents/developer-agent.ts` — output: código siguiendo stack del proyecto
    - Crear `src/agents/reviewer-agent.ts` — output: issues, severidad, sugerencias, veredicto
    - Crear `src/agents/qa-agent.ts` — output: test cases, edge cases, failure scenarios
    - Crear `src/agents/devops-agent.ts` — output: build steps, CI/CD config, deployment strategy
    - _Requirements: 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [x] 6.6 Property test: Coordinator asigna agentes según estado (Property 4)
    - **Property 4: Coordinator asigna agentes según estado del hilo**
    - Generar FullContext con diferentes estados de hilo, verificar plan correcto
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**

  - [x] 6.7 Property test: Output de agentes contiene secciones requeridas (Property 5)
    - **Property 5: Output de agentes contiene secciones requeridas por rol**
    - Generar contextos × roles, verificar que cada agente produce las secciones obligatorias
    - **Validates: Requirements 4.6, 4.7, 4.9, 4.10, 4.11, 4.12**

  - [x] 6.8 Unit tests para agentes
    - Tests para Coordinator: routing correcto por estado de hilo
    - Tests para Memory Agent: extracción y persistencia dual
    - Smoke test: 8 roles registrados en el factory
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.12_

- [x] 7. Checkpoint — Agentes funcionales
  - Ensure all tests pass, ask the user if questions arise.


- [x] 8. Orquestador
  - [x] 8.1 Implementar Event Router
    - Crear `src/orchestrator/event-router.ts` implementando EventRouter
    - Determinar si el evento debe procesarse y extraer contextKeys (orgId, projectId, threadId)
    - _Requirements: 2.1_

  - [x] 8.2 Implementar Context Loader
    - Crear `src/orchestrator/context-loader.ts` implementando ContextLoader
    - Cargar OrgContext, ProjectContext y ThreadContext desde Redis (primero) y Postgres (fallback)
    - Crear contexto por defecto si no existe
    - _Requirements: 2.1_

  - [x] 8.3 Implementar Prompt Builder
    - Crear `src/orchestrator/prompt-builder.ts` implementando PromptBuilder
    - Construir prompt en 4 capas: Prompt_Global + Prompt_de_Contexto (org, proyecto, hilo) + prompt de rol + reglas de steering
    - Usar resumen del hilo en lugar de historial completo cuando el resumen existe
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 8.4 Implementar Agent Executor
    - Crear `src/orchestrator/agent-executor.ts` implementando AgentExecutor
    - Ejecutar agentes en secuencia según ExecutionPlan del Coordinator
    - Invocar Memory Agent después de cada ejecución de agente
    - Manejar fallos: registrar error, notificar en Discord, continuar con siguiente agente
    - Timeout de 60s por agente
    - _Requirements: 2.3, 2.4, 2.6_

  - [x] 8.5 Implementar Response Manager
    - Crear `src/orchestrator/response-manager.ts` implementando ResponseManager
    - Enviar respuesta final al canal/hilo de Discord correspondiente
    - Formatear notificaciones de error según formato definido en diseño
    - _Requirements: 2.5_

  - [x] 8.6 Implementar Orchestrator principal y wiring
    - Crear `src/orchestrator/orchestrator.ts` implementando la interfaz Orchestrator
    - Conectar: EventRouter → ContextLoader → Coordinator → PromptBuilder → AgentExecutor → ResponseManager
    - Manejar flujo completo: evento → contexto → plan → ejecución → respuesta
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 8.7 Property test: Construcción de prompts incluye todas las capas (Property 2)
    - **Property 2: Construcción de prompts incluye todas las capas**
    - Generar FullContext + AgentRole aleatorios, verificar que el prompt contiene las 4 capas
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.5**

  - [x] 8.8 Property test: Prompt usa resumen en lugar de historial (Property 3)
    - **Property 3: Prompt usa resumen en lugar de historial completo**
    - Generar ThreadContext con resumen no vacío, verificar inclusión de resumen y exclusión de mensajes individuales
    - **Validates: Requirements 3.3, 8.3**

  - [x] 8.9 Property test: Ejecución secuencial del plan (Property 6)
    - **Property 6: Ejecución secuencial del plan con persistencia**
    - Generar planes aleatorios con N agentes, verificar orden exacto y que Memory se invoca después de cada agente
    - **Validates: Requirements 2.3, 2.4**

  - [x] 8.10 Property test: Continuidad ante fallo de agente (Property 7)
    - **Property 7: Continuidad del plan ante fallo de agente**
    - Generar planes con fallos aleatorios, verificar que el error se registra, se notifica y se continúa con los agentes restantes
    - **Validates: Requirements 2.6**

  - [x] 8.11 Unit tests para Orquestador
    - Test de flujo completo: evento → contexto → coordinator → agentes → respuesta
    - Test de continuación de cadena cuando un agente envía mensaje
    - Test de plan vacío del Coordinator → pedir más contexto al usuario
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 9. Checkpoint — Orquestador completo
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 10. Hooks de Discord: reacciones y eventos
  - [x] 10.1 Implementar handler de reacciones
    - Crear `src/orchestrator/reaction-handler.ts`
    - Mapear reacciones a agentes: ✅ → Reviewer/DevOps según contexto; ❌ → Developer; 🔁 → agente original; 🚀 → DevOps
    - _Requirements: 6.4, 6.5, 6.6, 6.7_

  - [x] 10.2 Implementar handler de creación de hilos
    - Crear `src/orchestrator/thread-handler.ts`
    - Clasificar hilo nuevo (feature, bug, pr, task), crear estado inicial en Redis y Postgres, ejecutar Coordinator
    - _Requirements: 6.1_

  - [x] 10.3 Implementar handler de comandos slash
    - Crear `src/orchestrator/slash-command-handler.ts`
    - Mapear cada comando al agente correspondiente: start → Coordinator (architect+planner), plan → Planner, code → Developer, review → Reviewer, test → QA, deploy → DevOps, summary → Memory
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 10.4 Property test: Reacciones invocan al agente correcto (Property 8)
    - **Property 8: Reacciones invocan al agente correcto según contexto**
    - Generar reacciones × contextos de hilo, verificar agente invocado
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.7**

  - [x] 10.5 Property test: Clasificación de hilos nuevos (Property 15)
    - **Property 15: Clasificación de hilos nuevos**
    - Generar hilos nuevos aleatorios, verificar tipo asignado válido (feature|bug|pr|task), estado inicial creado, Coordinator ejecutado
    - **Validates: Requirements 6.1**

  - [x] 10.6 Unit tests para hooks
    - Tests para cada reacción → agente correcto
    - Tests para cada comando slash → agente correcto
    - Tests para clasificación de hilos
    - _Requirements: 6.1, 6.4, 6.5, 6.6, 6.7, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 11. Checkpoint — Hooks de Discord completos
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 12. Integración con GitHub
  - [x] 12.1 Implementar GitHubClient
    - Crear `src/github/github-client.ts` implementando la interfaz GitHubClient
    - Métodos: approvePR, mergePR, createReviewComment usando GitHub REST API (octokit)
    - _Requirements: 9.3, 9.4_

  - [x] 12.2 Implementar flujo de PR automático
    - Conectar webhook de GitHub (ya normalizado en Gateway) con el Orquestador
    - Crear hilo de tipo "pr" automáticamente cuando llega webhook "opened"
    - Coordinator asigna Reviewer automáticamente para hilos tipo "pr"
    - Reacción ✅ en hilo PR aprobado → DevOps inicia merge vía GitHubClient
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 12.3 Property test: Webhook de GitHub produce hilo PR (Property 11)
    - **Property 11: Webhook de GitHub produce hilo de tipo PR**
    - Generar webhooks GitHub aleatorios con action "opened", verificar creación de hilo tipo "pr" con detalles correctos
    - **Validates: Requirements 9.1**

  - [x] 12.4 Unit tests para integración GitHub
    - Tests para GitHubClient: approve, merge, createReviewComment (con mocks)
    - Tests para flujo PR: webhook → hilo → review → merge
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 13. Checkpoint — GitHub integrado
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 14. Features avanzadas
  - [x] 14.1 Implementar memoria automática (auto-summary)
    - Crear `src/orchestrator/auto-summary.ts`
    - Detectar cuando messageCount - lastSummaryAt >= 15 y disparar Memory Agent
    - Resumen incluye: decisiones tomadas, estado actual, issues abiertos
    - Persistir resumen en PostgresStore y VectorStore
    - Actualizar lastSummaryAt en thread
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 14.2 Implementar auto-threading de errores
    - Crear `src/orchestrator/error-detector.ts`
    - Detectar patrones de error en mensajes/logs (stack traces, keywords de error)
    - Crear hilo de tipo "bug" automáticamente con contexto del error
    - Coordinator asigna Developer para fix automático
    - _Requirements: 10.1, 10.2_

  - [x] 14.3 Implementar debate multi-agente
    - Crear `src/orchestrator/debate-manager.ts`
    - Coordinator inicia debate entre Architect y Reviewer cuando se requieren múltiples perspectivas
    - Argumentos alternados en el hilo de Discord
    - Límite de 4 turnos: si no hay consenso, generar resumen de posiciones y solicitar decisión al usuario
    - _Requirements: 10.3, 10.4_

  - [x] 14.4 Property test: Trigger de resumen automático (Property 9)
    - **Property 9: Trigger de resumen automático cada 15 mensajes**
    - Generar contadores aleatorios (messageCount, lastSummaryAt), verificar trigger cuando diferencia >= 15
    - **Validates: Requirements 8.1**

  - [x] 14.5 Property test: Detección de errores crea hilos bug (Property 13)
    - **Property 13: Detección de errores crea hilos de bug**
    - Generar mensajes con/sin patrones de error, verificar creación de hilo solo cuando hay error
    - **Validates: Requirements 10.1**

  - [x] 14.6 Property test: Debate se limita a 4 turnos (Property 14)
    - **Property 14: Debate multi-agente se limita a 4 turnos**
    - Generar debates con N turnos (1-10), verificar corte a 4 y generación de resumen
    - **Validates: Requirements 10.4**

  - [x] 14.7 Unit tests para features avanzadas
    - Tests para auto-summary: trigger a 15 mensajes, persistencia dual
    - Tests para auto-threading: detección de errores, creación de hilo bug
    - Tests para debate: límite de turnos, resumen de posiciones
    - _Requirements: 8.1, 8.2, 8.3, 10.1, 10.2, 10.3, 10.4_

- [x] 15. Checkpoint — Features avanzadas completas
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 16. Wiring final y entry point
  - [x] 16.1 Crear entry point principal
    - Crear `src/index.ts` que inicializa todos los componentes: Gateway, Orquestador, Stores, AgentFactory
    - Conectar Gateway → Orquestador (event handler)
    - Inicializar conexiones: Redis, Postgres, Discord
    - Graceful shutdown: cerrar conexiones en SIGINT/SIGTERM
    - _Requirements: 1.1, 2.1_

  - [x] 16.2 Crear scripts de base de datos
    - Crear `src/persistence/migrations/` con migration SQL inicial (esquema completo)
    - Crear script de seed para datos de prueba (org, proyecto, thread de ejemplo)
    - Configurar drizzle-kit para migraciones
    - _Requirements: 5.1_

  - [x] 16.3 Integration tests end-to-end
    - Test flujo completo: evento Discord → normalización → orquestador → agentes → respuesta (con mocks de Discord y Claude)
    - Test flujo PR: webhook GitHub → hilo → review → merge (con mocks)
    - Test flujo reacción: ✅ en hilo → agente correcto ejecutado
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 9.1, 9.2, 9.3_

  - [x] 16.4 Smoke tests
    - Verificar 8 roles registrados en AgentFactory
    - Verificar 7 comandos slash registrados
    - Verificar 4 estados de thread válidos (open, in_progress, review, done)
    - Verificar 4 tipos de thread válidos (feature, bug, pr, task)
    - Verificar 3 eventos soportados (on_thread_create, on_message, on_reaction_add)
    - _Requirements: 4.1, 7.1, 5.6, 5.7, 1.4_

- [x] 17. Checkpoint final — Sistema completo
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Property tests validan las 15 propiedades de corrección del diseño usando fast-check
- Unit tests validan ejemplos específicos y edge cases
- El stack es TypeScript con discord.js, ioredis, drizzle-orm, pgvector, @anthropic-ai/sdk y fast-check
