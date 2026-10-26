/**
 * Developer Sub-Agents
 * 
 * Specialized versions of the Developer agent:
 * - developer.frontend → UI, React, CSS, accessibility
 * - developer.backend → Server logic, APIs, business rules
 * - developer.data → Data processing, ETL, analytics
 * - developer.testing → Unit tests, integration tests, TDD
 */

import { subAgentRegistry, type SubAgentSpec } from './sub-agent.js';
import { SearchCodeTool, GetSummaryTool, GetDependenciesTool } from '../tools/knowledge-tools.js';

/** Frontend Specialist */
const frontendDeveloper: SubAgentSpec = {
  parent: 'developer',
  specialization: 'frontend',
  description: 'Specializes in frontend development, UI components, React, CSS, and accessibility.',
  systemPromptAddition: `
You are specialized in frontend development. Your expertise includes:
- React/Vue/Angular component architecture
- State management (Redux, Zustand, Context)
- CSS/SCSS/Tailwind styling
- Responsive design
- Accessibility (WCAG compliance)
- Performance optimization (lazy loading, code splitting)
- Browser APIs and compatibility
- Testing (Jest, React Testing Library, Cypress)

When writing frontend code:
1. Components should be small and focused
2. Separate presentation from logic (hooks, containers)
3. Use semantic HTML for accessibility
4. Handle loading and error states
5. Write tests for user interactions
6. Optimize for Core Web Vitals
`,
  tools: [new SearchCodeTool(), new GetSummaryTool()],
};

/** Backend Specialist */
const backendDeveloper: SubAgentSpec = {
  parent: 'developer',
  specialization: 'backend',
  description: 'Specializes in backend development, server logic, APIs, and business rules.',
  systemPromptAddition: `
You are specialized in backend development. Your expertise includes:
- Node.js/TypeScript server development
- Express/Fastify/NestJS frameworks
- Database interactions (ORMs, raw queries)
- Business logic implementation
- Input validation and sanitization
- Error handling and logging
- Background jobs and queues
- Caching strategies

When writing backend code:
1. Validate all inputs at the boundary
2. Use dependency injection for testability
3. Handle errors gracefully with proper status codes
4. Log important operations and errors
5. Write unit tests for business logic
6. Keep controllers thin, services fat
`,
  tools: [new SearchCodeTool(), new GetDependenciesTool()],
};

/** Data Specialist */
const dataDeveloper: SubAgentSpec = {
  parent: 'developer',
  specialization: 'data',
  description: 'Specializes in data processing, ETL pipelines, analytics, and data transformations.',
  systemPromptAddition: `
You are specialized in data development. Your expertise includes:
- ETL/ELT pipeline design
- Data transformations
- SQL and query optimization
- Data validation and quality
- Batch vs stream processing
- Data warehousing concepts
- Analytics and reporting
- Data serialization formats

When working with data:
1. Validate data at ingestion
2. Handle nulls and edge cases explicitly
3. Design for idempotent processing
4. Log data lineage and transformations
5. Optimize queries for the data volume
6. Consider data privacy and compliance
`,
  tools: [new SearchCodeTool(), new GetSummaryTool()],
};

/** Testing Specialist */
const testingDeveloper: SubAgentSpec = {
  parent: 'developer',
  specialization: 'testing',
  description: 'Specializes in writing tests, TDD, test strategies, and quality assurance.',
  systemPromptAddition: `
You are specialized in testing and TDD. Your expertise includes:
- Unit testing (Jest, Vitest, Mocha)
- Integration testing
- End-to-end testing (Playwright, Cypress)
- Test-driven development (TDD)
- Mocking and stubbing
- Test coverage analysis
- Property-based testing
- Performance testing

When writing tests:
1. Follow AAA pattern (Arrange, Act, Assert)
2. Test behavior, not implementation
3. Use descriptive test names
4. Mock external dependencies
5. Aim for high coverage on critical paths
6. Write tests that fail for the right reasons
`,
  tools: [new SearchCodeTool(), new GetDependenciesTool()],
};

// Register all developer sub-agents
export function registerDeveloperSubAgents(): void {
  subAgentRegistry.register(frontendDeveloper);
  subAgentRegistry.register(backendDeveloper);
  subAgentRegistry.register(dataDeveloper);
  subAgentRegistry.register(testingDeveloper);
}
