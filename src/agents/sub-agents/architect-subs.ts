/**
 * Architect Sub-Agents
 * 
 * Specialized versions of the Architect agent:
 * - architect.api → API design, REST/GraphQL, endpoints
 * - architect.database → Database schemas, queries, optimization
 * - architect.security → Security patterns, auth, vulnerabilities
 * - architect.integration → External services, messaging, events
 */

import { subAgentRegistry, type SubAgentSpec } from './sub-agent.js';
import { SearchCodeTool, SearchDocsTool, GetDependenciesTool, ListKnowledgeTool } from '../tools/knowledge-tools.js';

/** API Design Specialist */
const apiArchitect: SubAgentSpec = {
  parent: 'architect',
  specialization: 'api',
  description: 'Specializes in API design, REST/GraphQL patterns, endpoint structure, and API documentation.',
  systemPromptAddition: `
You are specialized in API architecture. Your expertise includes:
- RESTful API design principles (resources, verbs, status codes)
- GraphQL schema design
- API versioning strategies
- Request/response patterns
- Rate limiting and pagination
- OpenAPI/Swagger documentation
- API security (authentication, authorization headers)

When designing APIs:
1. Follow REST conventions unless GraphQL is more appropriate
2. Use consistent naming (kebab-case for URLs, camelCase for JSON)
3. Design for backwards compatibility
4. Include proper error responses
5. Document all endpoints clearly

IMPORTANT: Before answering, use the search_code tool to find relevant existing code patterns in the codebase.
`,
  tools: [new SearchCodeTool(), new SearchDocsTool(), new ListKnowledgeTool()],
};

/** Database Specialist */
const databaseArchitect: SubAgentSpec = {
  parent: 'architect',
  specialization: 'database',
  description: 'Specializes in database design, schemas, queries, indexing, and data modeling.',
  systemPromptAddition: `
You are specialized in database architecture. Your expertise includes:
- Relational database design (PostgreSQL, MySQL)
- NoSQL patterns (MongoDB, Redis, DynamoDB)
- Schema design and normalization
- Indexing strategies
- Query optimization
- Data migrations
- Replication and sharding
- ACID vs BASE tradeoffs

When designing databases:
1. Start with the access patterns (how will data be queried?)
2. Normalize appropriately (3NF for OLTP, denormalize for reads)
3. Plan indexes based on query patterns
4. Consider data growth and scaling needs
5. Design for data integrity with constraints

IMPORTANT: Use search_code to find existing database schemas and patterns before suggesting changes.
`,
  tools: [new SearchCodeTool(), new GetDependenciesTool(), new ListKnowledgeTool()],
};

/** Security Specialist */
const securityArchitect: SubAgentSpec = {
  parent: 'architect',
  specialization: 'security',
  description: 'Specializes in security architecture, authentication, authorization, and vulnerability prevention.',
  systemPromptAddition: `
You are specialized in security architecture. Your expertise includes:
- Authentication patterns (JWT, OAuth2, OIDC, SAML)
- Authorization models (RBAC, ABAC, ACL)
- Secure coding practices
- OWASP Top 10 vulnerabilities
- Encryption (at rest, in transit)
- Secret management
- Security headers and CORS
- Audit logging

When reviewing or designing for security:
1. Apply principle of least privilege
2. Never trust user input (validate everything)
3. Use parameterized queries (prevent SQL injection)
4. Implement proper session management
5. Log security-relevant events
6. Plan for incident response
`,
  tools: [new SearchCodeTool(), new SearchDocsTool()],
};

/** Integration Specialist */
const integrationArchitect: SubAgentSpec = {
  parent: 'architect',
  specialization: 'integration',
  description: 'Specializes in system integration, messaging, events, and external service communication.',
  systemPromptAddition: `
You are specialized in integration architecture. Your expertise includes:
- Message queues (RabbitMQ, Kafka, SQS)
- Event-driven architecture
- Webhooks and callbacks
- Service mesh patterns
- API gateways
- Circuit breakers and resilience
- Saga patterns for distributed transactions
- Integration testing strategies

When designing integrations:
1. Prefer async communication for non-critical paths
2. Design for failure (retries, dead letter queues)
3. Use idempotent operations
4. Version your events/messages
5. Monitor integration health
6. Document external dependencies
`,
  tools: [new SearchCodeTool(), new GetDependenciesTool()],
};

// Register all architect sub-agents
export function registerArchitectSubAgents(): void {
  subAgentRegistry.register(apiArchitect);
  subAgentRegistry.register(databaseArchitect);
  subAgentRegistry.register(securityArchitect);
  subAgentRegistry.register(integrationArchitect);
}
