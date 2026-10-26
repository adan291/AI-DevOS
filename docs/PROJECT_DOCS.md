# 📖 Documentación: DiscordIA

> Documentación auto-generada el 3/5/2026

---

## Overview

**Resumen del Proyecto: DiscordIA**

**¿Qué es?**
DiscordIA (AI DevOS) es un sistema de desarrollo operativo multi-agente construido sobre la plataforma de mensajería Discord. Se trata de una herramienta que permite a los desarrolladores crear y gestionar múltiples agentes inteligentes para automatizar tareas y procesos en diferentes plataformas de chat.

**¿Para quién?**
Este proyecto está diseñado para desarrolladores, especialmente aquellos que trabajan con tecnologías como Discord, Slack, Telegram y GitHub. También puede ser útil para equipos de DevOps y científicos de datos que necesitan automatizar tareas complejas en múltiples plataformas.

**¿Qué características tiene?**
DiscordIA soporta múltiples plataformas de chat (Discord, Slack, Telegram, Webhook/CLI) y múltiples sistemas de control de versiones (GitHub, GitLab). También cuenta con una arquitectura modular que permite a los desarrolladores agregar o remover agentes según sea necesario. Además, incluye un sistema de persistencia para almacenar datos y estado entre diferentes ejecuciones.

**¿Cómo se integra?**
El proyecto proporciona una API REST para interactuar con la plataforma y un conjunto de adaptadores para conectar con diferentes servicios externos (por ejemplo, GitHub). Los desarrolladores pueden crear sus propios agentes personalizados utilizando el framework proporcionado.

**¿Qué tecnologías utiliza?**
DiscordIA está construido sobre TypeScript y utiliza frameworks como Drizzle-ORM, ioredis y OpenAI. También incluye herramientas de testing y depuración para garantizar la calidad del código.

**Documentación disponible:**

* [Knowledge Base](https://discordia.kb/docs/): Documentos generales sobre el proyecto, incluyendo guías de instalación y configuración.
* [API Documentation](https://discordia.kb/docs/api/): Documentación detallada de la API REST proporcionada por DiscordIA.

Espero que esta información sea útil para los nuevos miembros del equipo. ¡Si tienes alguna pregunta o necesitas ayuda adicional, no dudes en preguntar!

---

## Architecture

**Arquitectura de la aplicación DiscordIA**

La aplicación DiscordIA es un sistema operativo de desarrollo multi-agente construido sobre Discord. A continuación, se describe su arquitectura en detalle.

### Componentes principales

1. **Orquestador**: El corazón del sistema, responsable de gestionar los agentes y coordinar sus acciones.
2. **Agentes**: Los componentes que realizan tareas específicas dentro del sistema, como la planificación, el desarrollo, la revisión y la depuración.
3. **Almacenamiento de conocimiento**: Un componente responsable de almacenar y recuperar información relevante para los agentes.
4. **Adaptadores**: Componentes que permiten a los agentes interactuar con plataformas externas, como Discord, Slack, Telegram y GitHub.

### Interacción entre componentes

1. Los agentes se registran en el orquestador, quien los gestiona y coordina sus acciones.
2. El orquestador solicita información a los adaptadores para obtener datos de las plataformas externas.
3. Los agentes utilizan la información obtenida para realizar sus tareas y almacenar resultados en el almacenamiento de conocimiento.
4. El orquestador monitorea el progreso de los agentes y ajusta su planificación según sea necesario.

### Flujo de datos

1. **Entrada**: Los agentes reciben solicitudes de información de las plataformas externas a través de los adaptadores.
2. **Procesamiento**: Los agentes procesan la información y almacenar resultados en el almacenamiento de conocimiento.
3. **Salida**: El orquestador proporciona retroalimentación a los agentes sobre su progreso y ajusta su planificación según sea necesario.

### Diseños de patrón utilizados

1. **Patrón de fabrica**: Utilizado para crear instancias de los agentes.
2. **Patrón de observador**: Utilizado para notificar a los agentes sobre cambios en el estado del sistema.
3. **Patrón de singleton**: Utilizado para garantizar que solo haya una instancia del orquestador.

### Consideraciones adicionales

* La aplicación utiliza TypeScript como lenguaje de programación principal.
* Se utiliza la biblioteca `drizzle-orm` para interactuar con bases de datos PostgreSQL.
* Se utiliza la biblioteca `ioredis` para interactuar con un servidor Redis.
* La aplicación cuenta con pruebas unitarias y de integración para garantizar su funcionalidad.

Espero que esta descripción haya sido útil. ¡Si tienes alguna pregunta o necesitas más detalles, no dudes en preguntar!

---

## Tech Stack

**Tecnología utilizada en el proyecto DiscordIA**

### Base de datos

* **Postgres**: Se utiliza como base de datos principal del proyecto. Es una base de datos relacional que ofrece un alto nivel de seguridad y escalabilidad.
* **Redis**: Se utiliza como caché para mejorar el rendimiento y la velocidad de respuesta del sistema.
* **Vector Store**: Se utiliza para almacenar y procesar grandes cantidades de vectores numéricos.

**Motivo:** La elección de Postgres se debe a su capacidad para manejar grandes volúmenes de datos y su alto nivel de seguridad. Redis se utiliza como caché para mejorar el rendimiento y la velocidad de respuesta del sistema. El Vector Store se utiliza para almacenar y procesar grandes cantidades de vectores numéricos.

### Servicios de API

* **Discord.js**: Se utiliza para interactuar con la API de Discord.
* **OpenAI**: Se utiliza para acceder a los servicios de inteligencia artificial de OpenAI.
* **Anthropic-ai/sdk**: Se utiliza para acceder a los servicios de inteligencia artificial de Anthropic.

**Motivo:** La elección de Discord.js se debe a su capacidad para interactuar con la API de Discord. OpenAI y Anthropic-ai/sdk se utilizan para acceder a los servicios de inteligencia artificial respectivos.

### Herramientas de desarrollo

* **TypeScript**: Se utiliza como lenguaje de programación principal del proyecto.
* **Vitest**: Se utiliza como framework de pruebas unitarias y de integración.
* **Fast-check**: Se utiliza para realizar pruebas de propiedades.
* **Drizzle-ORM**: Se utiliza como ORM (Object Relational Mapping) para interactuar con la base de datos.

**Motivo:** La elección de TypeScript se debe a su capacidad para escribir código más seguro y mantenible. Vitest se utiliza para realizar pruebas unitarias y de integración. Fast-check se utiliza para realizar pruebas de propiedades. Drizzle-ORM se utiliza como ORM para interactuar con la base de datos.

### Otras herramientas

* **Dotenv**: Se utiliza para manejar variables de entorno.
* **pgvector**: Se utiliza para almacenar y procesar vectores numéricos en la base de datos.

**Motivo:** La elección de Dotenv se debe a su capacidad para manejar variables de entorno de manera segura. pgvector se utiliza para almacenar y procesar vectores numéricos en la base de datos.

### Tecnologías adicionales

* **Node.js**: Se utiliza como entorno de ejecución del proyecto.
* **Express.js**: No se utiliza explícitamente, pero se puede inferir que se utiliza para crear un servidor web.

**Motivo:** La elección de Node.js se debe a su capacidad para manejar solicitudes y respuestas HTTP. Express.js no se utiliza explícitamente, pero se puede inferir que se utiliza para crear un servidor web.

---

## API Endpoints

**API Endpoints de DiscordIA**

La siguiente es la documentación de los endpoints API disponibles en el proyecto DiscordIA.

### Agentes y Orquestador

#### **GET /agents**

* Método: `GET`
* Ruta: `/agents`
* Descripción: Obtiene una lista de agentes disponibles.
* Requisitos de autenticación: Ninguno
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`[ { id: string, name: string } ]`)

#### **GET /orchestrator**

* Método: `GET`
* Ruta: `/orchestrator`
* Descripción: Obtiene información sobre el orquestador actual.
* Requisitos de autenticación: Ninguno
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`{ id: string, name: string }`)

### Integraciones

#### **POST /integrations**

* Método: `POST`
* Ruta: `/integrations`
* Descripción: Crea una nueva integración con un proveedor de servicios.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: JSON (`{ provider: string, credentials: { [key: string]: any } }`)
* Formato de respuesta: JSON (`{ id: string, name: string }`)

#### **GET /integrations**

* Método: `GET`
* Ruta: `/integrations`
* Descripción: Obtiene una lista de integraciones disponibles.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`[ { id: string, name: string } ]`)

### Proyectos

#### **GET /projects**

* Método: `GET`
* Ruta: `/projects`
* Descripción: Obtiene una lista de proyectos disponibles.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`[ { id: string, name: string } ]`)

#### **POST /projects**

* Método: `POST`
* Ruta: `/projects`
* Descripción: Crea un nuevo proyecto.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: JSON (`{ name: string, description: string }`)
* Formato de respuesta: JSON (`{ id: string, name: string }`)

### Tareas

#### **GET /tasks**

* Método: `GET`
* Ruta: `/tasks`
* Descripción: Obtiene una lista de tareas disponibles.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`[ { id: string, name: string } ]`)

#### **POST /tasks**

* Método: `POST`
* Ruta: `/tasks`
* Descripción: Crea una nueva tarea.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: JSON (`{ name: string, description: string }`)
* Formato de respuesta: JSON (`{ id: string, name: string }`)

### Notificaciones

#### **GET /notifications**

* Método: `GET`
* Ruta: `/notifications`
* Descripción: Obtiene una lista de notificaciones disponibles.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`[ { id: string, name: string } ]`)

#### **POST /notifications**

* Método: `POST`
* Ruta: `/notifications`
* Descripción: Crea una nueva notificación.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: JSON (`{ name: string, description: string }`)
* Formato de respuesta: JSON (`{ id: string, name: string }`)

### Autenticación

#### **POST /login**

* Método: `POST`
* Ruta: `/login`
* Descripción: Inicia sesión con un usuario.
* Requisitos de autenticación: Ninguno
* Formato de solicitud: JSON (`{ username: string, password: string }`)
* Formato de respuesta: Token de acceso

#### **GET /logout**

* Método: `GET`
* Ruta: `/logout`
* Descripción: Cierra sesión.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: No aplica
* Formato de respuesta: Ninguno

### Errores y excepciones

#### **GET /errors**

* Método: `GET`
* Ruta: `/errors`
* Descripción: Obtiene una lista de errores disponibles.
* Requisitos de autenticación: Ninguno
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`[ { id: string, name: string } ]`)

#### **POST /errors**

* Método: `POST`
* Ruta: `/errors`
* Descripción: Crea un nuevo error.
* Requisitos de autenticación: Ninguno
* Formato de solicitud: JSON (`{ name: string, description: string }`)
* Formato de respuesta: JSON (`{ id: string, name: string }`)

### Configuración

#### **GET /config**

* Método: `GET`
* Ruta: `/config`
* Descripción: Obtiene la configuración actual.
* Requisitos de autenticación: Ninguno
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`{ [key: string]: any }`)

#### **POST /config**

* Método: `POST`
* Ruta: `/config`
* Descripción: Actualiza la configuración.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: JSON (`{ [key: string]: any }`)
* Formato de respuesta: Ninguno

### Documentación

#### **GET /docs**

* Método: `GET`
* Ruta: `/docs`
* Descripción: Obtiene la documentación actual.
* Requisitos de autenticación: Ninguno
* Formato de solicitud: No aplica
* Formato de respuesta: JSON (`{ [key: string]: any }`)

#### **POST /docs**

* Método: `POST`
* Ruta: `/docs`
* Descripción: Actualiza la documentación.
* Requisitos de autenticación: Token de acceso
* Formato de solicitud: JSON (`{ [key: string]: any }`)
* Formato de respuesta: Ninguno

Espero que esta documentación sea útil para usted. Recuerde consultar la documentación oficial del proyecto y el código fuente para obtener más información sobre los endpoints API disponibles.

---

## Setup & Usage

**Guía de configuración y uso de DiscordIA**

**Requisitos previos**

* Tener Node.js instalado en la versión 20.0.0 o superior.
* Tener TypeScript instalado en la versión 5.7.2 o superior.
* Tener las dependencias necesarias instaladas, que se pueden encontrar en el archivo `package.json`.

**Instalación**

1. Clonar el repositorio de DiscordIA en un directorio local.
2. Instalar las dependencias ejecutando el comando `npm install` en la raíz del proyecto.
3. Configurar las variables de entorno necesarias, como se describe a continuación.

**Variables de entorno**

* `CHAT_ADAPTERS`: una lista de adaptadores de chat que se deben inicializar (por ejemplo, `discord, slack, telegram`).
* `DB_HOST`: la dirección del servidor de base de datos.
* `DB_USER`: el nombre de usuario para acceder a la base de datos.
* `DB_PASSWORD`: la contraseña para acceder a la base de datos.

**Ejecución en desarrollo**

1. Ejecutar el comando `npm start` en la raíz del proyecto.
2. La aplicación se iniciará en modo desarrollo, y podrás interactuar con ella mediante el botón de inicio en la página web.

**Compilación para producción**

1. Ejecutar el comando `npm run build` en la raíz del proyecto.
2. La aplicación se compilará para producción, y podrás ejecutarla mediante el comando `node dist/index.js`.

**Comandos adicionales**

* `npm run test`: ejecuta los tests de unidad y de integración.
* `npm run dev`: inicia la aplicación en modo desarrollo con el watcher de TypeScript.

**Documentación adicional**

La documentación completa del proyecto se encuentra en el archivo `README.md` en la raíz del proyecto. También se pueden encontrar más detalles sobre las dependencias y configuraciones específicas en los archivos `package.json` y `tsconfig.json`.

Espero que esta guía te sea útil para configurar y utilizar DiscordIA. Si tienes alguna pregunta o necesitas ayuda adicional, no dudes en preguntar.

---

