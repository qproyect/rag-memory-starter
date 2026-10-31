# Servicio Minimalista de Memoria RAG

Un microservicio de memoria para Generación Aumentada por Recuperación (RAG) limpio y listo para producción, desarrollado con **Node.js 20**, **TypeScript (estricto)**, **Fastify** y **PostgreSQL 16 + pgvector**.

Este repositorio demuestra patrones de ingeniería de IA aplicada para la persistencia y recuperación contextual de memorias:
1. **Búsqueda Híbrida**: Búsqueda por texto completo nativa de PostgreSQL (`tsvector`) combinada con búsqueda vectorial semántica (distancia coseno con `pgvector`).
2. **Fusión por Rango Recíproco (RRF)**: Algoritmo de combinación agnóstico a escalas que fusiona los ordenamientos léxicos y semánticos sin necesidad de ajustar pesos arbitrarios ni normalizaciones manuales.
3. **Capa de Proveedores LLM con Failover**: Interfaz común `LLMProvider` con un `FailoverProvider` que intenta proveedores en cascada respetando tiempos de espera (*timeouts*), más un `MockProvider` determinístico sin dependencias externas para que los tests y `docker compose up` funcionen de inmediato sin necesidad de claves de API.
4. **Validación Estructurada en JSON con Reintento**: Esquemas de Zod que garantizan respuestas tipadas y consistentes, con un mecanismo de autocorrección que reintenta la generación una única vez enviando el mensaje de error del validador al LLM en caso de respuesta malformada.

---

## Diagrama de Arquitectura

```mermaid
flowchart TD
    Client([Cliente HTTP]) -->|POST /query o POST /answer| Fastify[Fastify REST API]

    subgraph Capa de Almacenamiento y Recuperación
        Fastify --> MemorySvc[Servicio de Memoria]
        MemorySvc -->|Calcular embedding| ProviderLayer[Proveedor LLM / Embedder]
        MemorySvc -->|pgvector distancia coseno| PGVector[(PostgreSQL + pgvector)]
        MemorySvc -->|tsvector texto completo| PGText[(PostgreSQL FTS)]
        PGVector --> RRF[Algoritmo Reciprocal Rank Fusion]
        PGText --> RRF
    end

    subgraph Capa de Proveedores LLM
        ProviderLayer --> Failover[Failover Provider]
        Failover --> Mock[Mock Provider Determinístico]
        Failover --> OpenAI[API Compatible con OpenAI]
        Failover --> Ollama[Daemon Local de Ollama]
    end

    subgraph Capa de Generación Estructurada
        Fastify --> AnswerSvc[Servicio de Respuesta]
        RRF -->|Top-K Contexto| AnswerSvc
        AnswerSvc -->|Prompt + Contexto| ProviderLayer
        ProviderLayer -->|Salida Bruta| ZodValidator{Validador de Esquema Zod}
        ZodValidator -->|JSON Válido| Client
        ZodValidator -->|Inválido / Malformado| RetryPrompt[Prompt de Reintento con Feedback]
        RetryPrompt --> ProviderLayer
    end
```

---

## Inicio Rápido

### 1. Ejecución con Docker Compose (Sin Configuración Previa)
La configuración por defecto utiliza el `MockProvider` determinístico incorporado. No se requieren claves de API ni cuentas de terceros:

```bash
docker compose up --build
```

Esto iniciará la base de datos con la extensión `vector` habilitada y el servicio Fastify. Las migraciones de base de datos se ejecutan automáticamente durante el inicio.

### 2. Cargar Notas de Ejemplo de Dominio Público
Para poblar la base con 20 notas de dominio público (química culinaria, geografía y hechos históricos):

```bash
docker compose exec app npm run db:seed
```

O si estás ejecutando en el entorno local:
```bash
npm run db:seed
```

---

## Endpoints de la API y Ejemplos

### Guardar una Memoria (`POST /memories`)
Almacena un fragmento de conocimiento con metadatos y cálculo automático de embeddings vectoriales:

```bash
curl -X POST http://localhost:3000/memories \
  -H "Content-Type: application/json" \
  -d '{
    "text": "La cocción sous-vide implica sellar alimentos al vacío y cocinarlos en un baño de agua con control preciso de temperatura.",
    "metadata": {
      "category": "cooking",
      "topic": "technique"
    }
  }'
```

**Respuesta:**
```json
{
  "status": "success",
  "data": {
    "id": "7f093256-42bb-4144-8c88-e24c084777b7",
    "text": "La cocción sous-vide implica sellar alimentos al vacío y cocinarlos en un baño de agua con control preciso de temperatura.",
    "metadata": {
      "category": "cooking",
      "topic": "technique"
    },
    "created_at": "2025-10-31T20:30:00.000Z",
    "updated_at": "2025-10-31T20:30:00.000Z"
  }
}
```

---

### Búsqueda Híbrida (`POST /query`)
Ejecuta en paralelo la búsqueda semántica vectorial y la búsqueda por texto completo en PostgreSQL, combinándolas con Reciprocal Rank Fusion (RRF) y permitiendo filtros sobre metadatos:

```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "cocción en agua control de temperatura",
    "topK": 3,
    "metadataFilter": {
      "category": "cooking"
    }
  }'
```

**Respuesta:**
```json
{
  "status": "success",
  "total": 1,
  "results": [
    {
      "id": "7f093256-42bb-4144-8c88-e24c084777b7",
      "text": "La cocción sous-vide implica sellar alimentos al vacío y cocinarlos en un baño de agua con control preciso de temperatura.",
      "metadata": {
        "category": "cooking",
        "topic": "technique"
      },
      "score": 0.032522,
      "vectorRank": 1,
      "textRank": 1
    }
  ]
}
```

---

### Respuesta RAG Estructurada (`POST /answer`)
Recupera las memorias relevantes mediante búsqueda híbrida, inyecta el contexto en el prompt, consulta la cadena de proveedores y valida la respuesta contra un esquema de Zod estricto:

```bash
curl -X POST http://localhost:3000/answer \
  -H "Content-Type: application/json" \
  -d '{
    "query": "¿Cómo funciona la técnica de sous-vide?",
    "topK": 2
  }'
```

**Respuesta:**
```json
{
  "status": "success",
  "data": {
    "answer": "Deterministic mock answer responding to context.",
    "confidence": 0.95,
    "citations": ["seed-1", "seed-2"],
    "summary": "Synthetic mock summary generated without external network dependencies."
  },
  "context": [
    {
      "id": "7f093256-42bb-4144-8c88-e24c084777b7",
      "text": "La cocción sous-vide implica sellar alimentos al vacío...",
      "score": 0.032522
    }
  ],
  "meta": {
    "retried": false
  }
}
```

---

### Verificación de Estado (`GET /health`)
```bash
curl -i http://localhost:3000/health
```

---

## Decisiones de Diseño

### 1. ¿Por qué Búsqueda Híbrida (Vectorial + Texto Completo)?
La búsqueda vectorial sobresale encontrando similitudes conceptuales y semánticas generales, pero suele fallar ante códigos de identificación exactos, siglas, nombres propios poco comunes o números específicos. La búsqueda por texto completo (`tsvector` con `ts_rank_cd`) ofrece la precisión léxica necesaria para estas situaciones. Al combinar ambas estrategias en la misma base de PostgreSQL, obtenemos lo mejor de los dos mundos sin añadir la complejidad operativa de un clúster de búsqueda separado.

### 2. ¿Por qué Reciprocal Rank Fusion (RRF)?
Un problema recurrente al fusionar búsqueda vectorial y textual es la calibración de puntajes: la distancia coseno no es comparable directamente con el puntaje de relevancia de BM25 o `ts_rank` sin recurrir a ponderaciones empíricas que quedan desactualizadas cuando los datos crecen.

RRF resuelve esto trabajando sobre la posición u ordenamiento ordinal relativo de cada documento:

$$RRF\_Score(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$

Donde:
- $M$ son los métodos de recuperación utilizados.
- $r_m(d)$ es la posición (1-indexed) del documento $d$ en el método $m$.
- $k$ es una constante de suavizado (estándar en la literatura: 60) que atenúa la influencia de documentos irrelevantes en posiciones bajas, otorgando una ventaja clara a los elementos que rankean alto en ambos listados.

### 3. ¿Por qué Validación de Esquema con Zod y Autocorrección?
Los modelos de lenguaje pueden generar preámbulos no solicitados (*"Por supuesto, aquí tienes el JSON:"*) o equivocarse en los nombres de atributos. Para proteger a los sistemas downstream:
- Se limpia cualquier bloque envolvente en formato markdown.
- Se valida la carga útil contra un esquema formal de Zod (`answer`, `confidence: [0, 1]`, `citations: string[]`).
- Si la validación falla, se dispara de inmediato un único reintento targeted incluyendo el mensaje de error exacto para que el LLM corrija su salida sin interrumpir la petición del cliente.

### 4. ¿Por qué Failover y Mocking Determinístico?
El desarrollo diario y las suites de pruebas automatizadas no deben depender de conectividad a internet ni del estado de APIs comerciales externas. La arquitectura incluye:
- `MockProvider`: Generador de vectores determinísticos de 384 dimensiones y respuestas JSON estructuradas.
- `FailoverProvider`: Administra una cadena ordenada de proveedores con límites de tiempo (*timeouts*), asegurando continuidad de servicio ante caídas transitorias.

---

## Configuración de Entorno (`.env`)

Revisá `.env.example` para conocer las variables de configuración disponibles:

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `PORT` | Puerto del servidor Fastify | `3000` |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL | `postgresql://postgres:postgres@localhost:5432/rag_memory` |
| `PRIMARY_LLM_PROVIDER` | Proveedor principal (`mock`, `openai`, `ollama`) | `mock` |
| `FALLBACK_LLM_PROVIDERS` | Cadena de fallbacks separada por comas | `ollama,openai` |
| `PROVIDER_TIMEOUT_MS` | Tiempo de espera antes de activar el siguiente fallback | `5000` |
| `OPENAI_API_KEY` | Clave de API de OpenAI (opcional) | - |
| `OPENAI_BASE_URL` | Endpoint compatible con OpenAI | `https://api.openai.com/v1` |
| `OLLAMA_BASE_URL` | Endpoint local de Ollama | `http://localhost:11434` |

---

## Limitaciones y Consideraciones para Producción

- **Embeddings en Node**: El generador mock produce representaciones vectoriales determinísticas ideales para testing y validación local. Para entornos de alta escala, se recomienda configurar modelos de embeddings dedicados como `text-embedding-3-small` de OpenAI o un servidor de Ollama con `all-minilm`.
- **Índices de Base de Datos**: El esquema utiliza índices `HNSW`. Para volúmenes millonarios de vectores, es conveniente ajustar los parámetros de indexación (`m = 16`, `ef_construction = 64`) o particionar las tablas según necesidad.
- **Límite de Reintento Único**: La autocorrección se acota a un único reintento para evitar el consumo desmedido de tokens y sobrecostos de latencia. En caso de fallas consecutivas, la API retorna un error HTTP 500 descriptivo.

---

## Licencia

MIT © Lucas F. Meneses
