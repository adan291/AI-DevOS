# Documento de Requisitos — AI DevOS (Discord)

## Introducción

AI DevOS es un sistema operativo de desarrollo construido sobre Discord. No es un bot convencional: es un orquestador multi-agente con memoria persistente, CI/CD integrado y flujo autónomo. El sistema escucha eventos de Discord, los normaliza, carga contexto (organización, proyecto, hilo), decide qué agentes deben actuar, construye prompts dinámicos, ejecuta vía LLM y persiste el conocimiento generado.

## Glosario

- **Gateway**: Componente Discord Bot que escucha eventos y los reenvía al Orquestador sin contener lógica de negocio.
- **Orquestador**: Componente central event-driven que enruta eventos, construye prompts y controla el estado del sistema.
- **Motor_de_Agentes**: Componente que ejecuta roles de agentes y maneja conversaciones multi-step contra LLMs.
- **Coordinator_Agent**: Agente central que decide qué agentes deben actuar y en qué secuencia.
- **Architect_Agent**: Agente que define soluciones de alto nivel, componentes, flujo de datos y riesgos.
- **Planner_Agent**: Agente que descompone features en tareas ordenadas con dependencias y complejidad estimada.
- **Developer_Agent**: Agente que escribe código production-ready siguiendo el stack del proyecto.
- **Reviewer_Agent**: Agente que revisa código buscando bugs, seguridad, rendimiento y mantenibilidad.
- **QA_Agent**: Agente que genera casos de test, edge cases y escenarios de fallo.
- **DevOps_Agent**: Agente que maneja build steps, configuración CI/CD y estrategia de deployment.
- **Memory_Agent**: Agente que extrae y persiste conocimiento a largo plazo (decisiones, patrones, errores).
- **Thread**: Hilo de Discord que representa una tarea acotada (feature, bug, PR o task).
- **Org_Context**: Datos de la organización incluyendo estándares y arquitectura.
- **Project_Context**: Datos del proyecto incluyendo nombre, stack tecnológico y reglas.
- **Thread_Context**: Estado del hilo incluyendo tipo, resumen, estado, decisiones y artefactos.
- **Prompt_Global**: Prompt base que siempre se incluye en cada ejecución de agente.
- **Prompt_de_Contexto**: Prompt dinámico construido con datos de org, proyecto e hilo.
- **Redis_Store**: Almacén de estado vivo en Redis.
- **Postgres_Store**: Almacén de memoria estructurada en PostgreSQL.
- **Vector_Store**: Base de datos vectorial para contexto semántico.

## Requisitos

### Requisito 1: Gateway de Discord (Escucha de Eventos)

**User Story:** Como desarrollador del equipo, quiero que el sistema escuche todos los eventos relevantes de Discord, para que cada acción en el servidor se procese automáticamente.

#### Criterios de Aceptación

1. WHEN un evento de Discord es recibido (message, thread_create, reaction_add), THE Gateway SHALL reenviarlo al Orquestador en formato normalizado sin aplicar lógica de negocio.
2. WHEN el Gateway recibe un evento, THE Gateway SHALL incluir en el payload normalizado el identificador de servidor, canal, hilo y usuario.
3. IF el Gateway pierde conexión con Discord, THEN THE Gateway SHALL reconectarse automáticamente y reanudar la escucha de eventos.
4. THE Gateway SHALL soportar los eventos: on_thread_create, on_message y on_reaction_add.

### Requisito 2: Orquestador Event-Driven

**User Story:** Como sistema, quiero un orquestador central que procese eventos normalizados, para que cada evento siga el flujo correcto de agentes.

#### Criterios de Aceptación

1. WHEN el Orquestador recibe un evento normalizado, THE Orquestador SHALL cargar el Org_Context, Project_Context y Thread_Context correspondientes.
2. WHEN el contexto está cargado, THE Orquestador SHALL invocar al Coordinator_Agent para decidir qué agentes deben actuar.
3. WHEN el Coordinator_Agent devuelve un plan de ejecución, THE Orquestador SHALL ejecutar los agentes en la secuencia indicada.
4. WHEN un agente completa su ejecución, THE Orquestador SHALL invocar al Memory_Agent para persistir el conocimiento generado.
5. WHEN todos los agentes del plan completan su ejecución, THE Orquestador SHALL enviar la respuesta final al canal o hilo de Discord correspondiente.
6. IF un agente falla durante la ejecución, THEN THE Orquestador SHALL registrar el error, notificar en el hilo de Discord y continuar con el siguiente agente del plan.

### Requisito 3: Construcción Dinámica de Prompts

**User Story:** Como sistema, quiero construir prompts dinámicos con contexto completo, para que cada agente tenga la información necesaria sin recibir historial completo.

#### Criterios de Aceptación

1. THE Orquestador SHALL incluir el Prompt_Global en cada ejecución de agente.
2. WHEN se construye un prompt para un agente, THE Orquestador SHALL inyectar el Prompt_de_Contexto con datos de org, proyecto e hilo.
3. WHEN se construye un prompt, THE Orquestador SHALL incluir el resumen del hilo en lugar del historial completo de mensajes.
4. WHEN se construye un prompt para un agente específico, THE Orquestador SHALL incluir el prompt de rol correspondiente al agente asignado.
5. THE Orquestador SHALL incluir las reglas de interpretación (steering) que permiten inferir intención con input mínimo y actuar proactivamente cuando la confianza supera el 80%.

### Requisito 4: Sistema de 8 Agentes

**User Story:** Como equipo de desarrollo, quiero un sistema de agentes especializados, para que cada aspecto del desarrollo sea manejado por un rol experto.

#### Criterios de Aceptación

1. THE Motor_de_Agentes SHALL soportar exactamente 8 roles: coordinator, architect, planner, developer, reviewer, qa, devops y memory.
2. WHEN el Coordinator_Agent recibe un hilo nuevo, THE Coordinator_Agent SHALL asignar architect y planner como agentes iniciales.
3. WHEN se requiere implementación, THE Coordinator_Agent SHALL asignar al Developer_Agent.
4. WHEN existe código en el hilo, THE Coordinator_Agent SHALL asignar al Reviewer_Agent y al QA_Agent.
5. WHEN el código es aprobado, THE Coordinator_Agent SHALL asignar al DevOps_Agent.
6. WHEN el Architect_Agent ejecuta, THE Architect_Agent SHALL producir: overview de arquitectura, componentes, flujo de datos y riesgos.
7. WHEN el Planner_Agent ejecuta, THE Planner_Agent SHALL producir: tareas ordenadas, dependencias, edge cases y complejidad estimada.
8. WHEN el Developer_Agent ejecuta, THE Developer_Agent SHALL producir código siguiendo estrictamente el stack del proyecto sin inventar librerías.
9. WHEN el Reviewer_Agent ejecuta, THE Reviewer_Agent SHALL producir: issues encontrados, severidad, sugerencias de fix y veredicto (approve/reject).
10. WHEN el QA_Agent ejecuta, THE QA_Agent SHALL producir: casos de test, edge cases y escenarios de fallo.
11. WHEN el DevOps_Agent ejecuta, THE DevOps_Agent SHALL producir: build steps, configuración CI/CD y estrategia de deployment.
12. WHEN el Memory_Agent ejecuta, THE Memory_Agent SHALL extraer decisiones, patrones y errores, y persistirlos como JSON estructurado.

### Requisito 5: Modelo de Datos y Persistencia

**User Story:** Como sistema, quiero persistir estado y conocimiento en múltiples capas, para que el contexto se mantenga entre sesiones y sea consultable semánticamente.

#### Criterios de Aceptación

1. THE Postgres_Store SHALL almacenar datos estructurados de organizaciones (standards, architecture), proyectos (name, stack, rules) y threads (type, summary, state, decisions, artifacts).
2. THE Redis_Store SHALL almacenar el estado vivo de threads y sesiones activas.
3. THE Vector_Store SHALL almacenar embeddings de contexto semántico para consultas por similitud.
4. WHEN un thread cambia de estado, THE Orquestador SHALL actualizar el estado en Redis_Store y Postgres_Store.
5. WHEN el Memory_Agent persiste conocimiento, THE Memory_Agent SHALL escribir en Postgres_Store el JSON estructurado y en Vector_Store el embedding correspondiente.
6. THE Postgres_Store SHALL soportar los estados de thread: open, in_progress, review y done.
7. THE Postgres_Store SHALL soportar los tipos de thread: feature, bug, pr y task.

### Requisito 6: Hooks y Reacciones de Discord

**User Story:** Como usuario de Discord, quiero controlar el flujo del sistema con reacciones y eventos nativos, para que la interacción sea natural y sin fricción.

#### Criterios de Aceptación

1. WHEN se crea un nuevo hilo en Discord, THE Orquestador SHALL clasificar el hilo (feature, bug, pr o task), crear su estado inicial y ejecutar el Coordinator_Agent.
2. WHEN un usuario envía un mensaje en un hilo, THE Coordinator_Agent SHALL decidir el flujo de agentes apropiado.
3. WHEN un agente envía un mensaje en un hilo, THE Orquestador SHALL continuar la cadena de ejecución del plan.
4. WHEN un usuario reacciona con ✅ a un mensaje de agente, THE Orquestador SHALL interpretar la reacción como aprobación e invocar al Reviewer_Agent o DevOps_Agent según el contexto.
5. WHEN un usuario reacciona con ❌ a un mensaje de agente, THE Orquestador SHALL interpretar la reacción como solicitud de retrabajo e invocar al Developer_Agent.
6. WHEN un usuario reacciona con 🔁 a un mensaje de agente, THE Orquestador SHALL regenerar la respuesta del agente que produjo el mensaje.
7. WHEN un usuario reacciona con 🚀 a un mensaje de agente, THE Orquestador SHALL iniciar el flujo de deployment vía DevOps_Agent.

### Requisito 7: Comandos Slash

**User Story:** Como usuario de Discord, quiero comandos slash para invocar funciones específicas, para tener control explícito cuando lo necesite.

#### Criterios de Aceptación

1. THE Gateway SHALL registrar los comandos: /ai start, /ai plan, /ai code, /ai review, /ai test, /ai deploy y /ai summary.
2. WHEN un usuario ejecuta /ai start, THE Coordinator_Agent SHALL iniciar el flujo completo (architect + planner) para el hilo actual.
3. WHEN un usuario ejecuta /ai plan, THE Planner_Agent SHALL generar el plan de tareas para el hilo actual.
4. WHEN un usuario ejecuta /ai code, THE Developer_Agent SHALL generar código para la tarea actual del hilo.
5. WHEN un usuario ejecuta /ai review, THE Reviewer_Agent SHALL revisar el código existente en el hilo.
6. WHEN un usuario ejecuta /ai test, THE QA_Agent SHALL generar casos de test para el código del hilo.
7. WHEN un usuario ejecuta /ai deploy, THE DevOps_Agent SHALL iniciar el flujo de deployment.
8. WHEN un usuario ejecuta /ai summary, THE Memory_Agent SHALL generar un resumen del estado actual del hilo.

### Requisito 8: Memoria Automática

**User Story:** Como equipo, quiero que el sistema resuma automáticamente el progreso, para que el contexto se mantenga compacto y relevante.

#### Criterios de Aceptación

1. WHEN se acumulan 15 mensajes en un hilo sin resumen, THE Memory_Agent SHALL generar automáticamente un resumen con: decisiones tomadas, estado actual e issues abiertos.
2. WHEN el Memory_Agent genera un resumen automático, THE Memory_Agent SHALL persistirlo en Postgres_Store y Vector_Store.
3. WHEN se construye un prompt después de un resumen automático, THE Orquestador SHALL usar el resumen en lugar de los mensajes individuales anteriores al resumen.

### Requisito 9: Integración con GitHub

**User Story:** Como equipo de desarrollo, quiero integración bidireccional con GitHub, para que PRs, reviews y merges se gestionen desde Discord.

#### Criterios de Aceptación

1. WHEN GitHub envía un webhook de nuevo PR, THE Gateway SHALL crear un hilo automático en Discord de tipo "pr" con los detalles del PR.
2. WHEN se crea un hilo de tipo "pr", THE Coordinator_Agent SHALL asignar al Reviewer_Agent para review automático.
3. WHEN el Reviewer_Agent aprueba un PR, THE Orquestador SHALL reflejar la aprobación en GitHub vía API.
4. WHEN un usuario reacciona con ✅ en un hilo de PR aprobado, THE DevOps_Agent SHALL iniciar el merge del PR en GitHub.
5. IF el webhook de GitHub no puede ser procesado, THEN THE Gateway SHALL registrar el error y reintentar el procesamiento hasta 3 veces con backoff exponencial.

### Requisito 10: Features Avanzadas

**User Story:** Como equipo, quiero capacidades avanzadas de auto-threading, self-healing y debate multi-agente, para que el sistema sea proactivo y autónomo.

#### Criterios de Aceptación

1. WHEN se detecta un error en un mensaje o log, THE Orquestador SHALL crear automáticamente un hilo de tipo "bug" con el contexto del error.
2. WHEN se crea un hilo de bug por auto-threading, THE Coordinator_Agent SHALL asignar al Developer_Agent para generar un fix automático.
3. WHEN el Coordinator_Agent determina que una decisión de diseño requiere múltiples perspectivas, THE Coordinator_Agent SHALL iniciar un debate entre Architect_Agent y Reviewer_Agent en el hilo, presentando argumentos alternados.
4. WHEN un debate multi-agente alcanza 4 turnos sin consenso, THE Coordinator_Agent SHALL generar un resumen de posiciones y solicitar decisión al usuario.
