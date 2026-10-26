# Implementation Plan: Model Router

## Overview

This implementation plan breaks down the Model Router feature into incremental coding tasks. The Model Router is an intelligent LLM selection system that analyzes tasks, classifies complexity, and routes them to optimal models based on cost, speed, and capability requirements.

The implementation follows a bottom-up approach: core types → individual components → integration → testing.

## Tasks

- [x] 1. Set up project structure and core types
  - [x] 1.1 Create directory structure and core interfaces
    - Create `src/model-router/` directory
    - Create `src/model-router/index.ts` with module exports
    - Create `src/model-router/model-router.ts` with core types: `ComplexityLevel`, `Provider`, `ClassificationResult`, `ModelSelection`, `ExecutionMetrics`, `IModelRouter`
    - _Requirements: 1.1, 3.1, 5.1, 5.3_

  - [x] 1.2 Create model registry types and defaults
    - Create `src/model-router/model-registry.ts` with `ModelConfig`, `AgentOverride`, `IModelRegistry` interfaces
    - Define `DEFAULT_MODEL_MAPPINGS` for simple/medium/complex levels
    - Define `DEFAULT_AGENT_OVERRIDES` for coordinator and architect
    - _Requirements: 2.1, 2.2, 2.3, 8.1, 8.4_

  - [x] 1.3 Create task classifier types
    - Create `src/model-router/task-classifier.ts` with `ClassificationCriteria`, `ITaskClassifier` interfaces
    - Define `DEFAULT_CRITERIA` with keyword patterns for simple/medium/complex
    - Define `TOKEN_THRESHOLDS` constants
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 1.4 Create fallback strategy types
    - Create `src/model-router/fallback-strategy.ts` with `FallbackAction`, `FallbackAttempt`, `IFallbackStrategy` interfaces
    - Define `MAX_FALLBACK_ATTEMPTS` constant (3)
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x] 1.5 Create metrics tracker types
    - Create `src/model-router/metrics-tracker.ts` with `AggregatedMetrics`, `TimeRange`, `IMetricsTracker` interfaces
    - Define `METRICS_RETENTION_DAYS` constant (30)
    - _Requirements: 6.1, 6.3, 6.6_

  - [x] 1.6 Create provider health checker types
    - Create `src/model-router/provider-health.ts` with `ProviderHealth`, `IProviderHealthChecker` interfaces
    - Define `HEALTH_CHECK_INTERVAL_MS` (5 minutes) and `UNAVAILABLE_DURATION_MS` (1 minute)
    - _Requirements: 7.5, 7.6_

- [x] 2. Checkpoint - Verify types compile
  - Ensure all types compile without errors, ask the user if questions arise.

- [x] 3. Implement TaskClassifier component
  - [x] 3.1 Implement TaskClassifier class
    - Implement `classify()` method with keyword matching and token estimation
    - Implement `updateCriteria()` for runtime updates
    - Add 2-second timeout handling with medium fallback
    - Return confidence scores based on keyword match strength
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 3.2 Write property test for Property 1: Classification Output Validity
    - **Property 1: Classification Output Validity**
    - For any task string, result SHALL contain valid complexity level AND confidence 0.0-1.0
    - **Validates: Requirements 1.1, 1.6**

  - [x] 3.3 Write property test for Property 2: Simple Task Classification
    - **Property 2: Simple Task Classification**
    - Tasks with simple indicators SHALL be classified as 'simple'
    - **Validates: Requirements 1.2**

  - [x] 3.4 Write property test for Property 3: Medium Task Classification
    - **Property 3: Medium Task Classification**
    - Tasks with medium indicators SHALL be classified as 'medium'
    - **Validates: Requirements 1.3**

  - [x] 3.5 Write property test for Property 4: Complex Task Classification
    - **Property 4: Complex Task Classification**
    - Tasks with complex indicators SHALL be classified as 'complex'
    - **Validates: Requirements 1.4**

  - [x] 3.6 Write unit tests for TaskClassifier
    - Test classification of known simple tasks (formatting, single-file)
    - Test classification of known medium tasks (API integration, refactoring)
    - Test classification of known complex tasks (architecture, security)
    - Test timeout handling returns medium with low confidence
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 4. Implement ModelRegistry component
  - [x] 4.1 Implement ModelRegistry class
    - Implement `getModels()` returning models sorted by priority
    - Implement `getAgentOverride()` for agent-specific overrides
    - Implement `updateConfig()` with validation
    - Implement `setAgentOverride()` for runtime override updates
    - Implement `validate()` ensuring at least one model per level
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1, 8.3_

  - [x] 4.2 Write property test for Property 5: Registry Configuration Invariant
    - **Property 5: Registry Configuration Invariant**
    - After any valid update, every complexity level SHALL have at least one model
    - Invalid configurations SHALL be rejected with descriptive error
    - **Validates: Requirements 2.5, 2.6**

  - [x] 4.3 Write unit tests for ModelRegistry
    - Test default configuration loading
    - Test configuration validation rejects empty arrays
    - Test agent override retrieval
    - Test runtime configuration updates
    - _Requirements: 2.1, 2.4, 2.5, 2.6_

- [x] 5. Checkpoint - Verify TaskClassifier and ModelRegistry
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement ProviderHealthChecker component
  - [x] 6.1 Implement ProviderHealthChecker class
    - Implement `isAvailable()` checking API key and health status
    - Implement `getHealthStatus()` returning all provider statuses
    - Implement `markUnavailable()` with duration-based recovery
    - Implement `startHealthChecks()` with 5-minute interval
    - Implement `stopHealthChecks()` for cleanup
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_

  - [x] 6.2 Write property test for Property 16: Provider Unavailability Handling
    - **Property 16: Provider Unavailability Handling**
    - Providers with missing API key OR failed health check SHALL be marked unavailable
    - After health check failure, provider SHALL remain unavailable for exactly 1 minute
    - **Validates: Requirements 7.3, 7.6**

  - [x] 6.3 Write unit tests for ProviderHealthChecker
    - Test provider marked unavailable when API key missing
    - Test health check failure marks provider unavailable
    - Test provider becomes available after 1 minute
    - Test periodic health checks run on interval
    - _Requirements: 7.1, 7.3, 7.5, 7.6_

- [x] 7. Implement FallbackStrategy component
  - [x] 7.1 Implement FallbackStrategy class
    - Implement `getNextAction()` determining retry/fallback/escalate/fail
    - Implement `isRateLimitError()` detecting 429 errors
    - Implement `getRetryAfterMs()` extracting retry-after header
    - Handle rate limit with wait-and-retry logic
    - Handle non-rate-limit errors with immediate fallback
    - Implement complexity escalation when all models fail
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 7.2 Write property test for Property 8: Rate Limit Retry Behavior
    - **Property 8: Rate Limit Retry Behavior**
    - Rate limit errors SHALL wait for retry-after duration and retry once before fallback
    - **Validates: Requirements 4.1**

  - [x] 7.3 Write property test for Property 9: Non-Rate-Limit Fallback
    - **Property 9: Non-Rate-Limit Fallback**
    - Non-rate-limit errors SHALL immediately select next available model
    - **Validates: Requirements 4.2**

  - [x] 7.4 Write property test for Property 10: Complexity Escalation on Exhaustion
    - **Property 10: Complexity Escalation on Exhaustion**
    - When all models for a level fail, SHALL escalate to next higher level
    - **Validates: Requirements 4.3**

  - [x] 7.5 Write property test for Property 11: Comprehensive Failure Reporting
    - **Property 11: Comprehensive Failure Reporting**
    - When all fallbacks fail, error SHALL contain details of every attempted model
    - **Validates: Requirements 4.4**

  - [x] 7.6 Write property test for Property 12: Maximum Fallback Attempts
    - **Property 12: Maximum Fallback Attempts**
    - SHALL attempt at most 3 fallback models (4 total including initial)
    - **Validates: Requirements 4.5**

  - [x] 7.7 Write unit tests for FallbackStrategy
    - Test rate limit error detection
    - Test retry-after extraction
    - Test fallback model selection
    - Test escalation from simple to medium to complex
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

- [x] 8. Checkpoint - Verify ProviderHealthChecker and FallbackStrategy
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement database schema for metrics
  - [x] 9.1 Add modelUsageMetrics table to schema
    - Add `modelUsageMetrics` table to `src/persistence/schema.ts`
    - Include fields: id, provider, model, complexity, agentRole, inputTokens, outputTokens, latencyMs, estimatedCost, success, error, fallbackUsed, fallbackChain, createdAt
    - Add indexes for provider, model, complexity, agentRole, createdAt, success
    - Export `ModelUsageMetric` and `NewModelUsageMetric` types
    - _Requirements: 6.1, 6.5_

  - [x] 9.2 Create database migration for modelUsageMetrics
    - Create migration file in `drizzle/` directory
    - Include table creation and index creation SQL
    - _Requirements: 6.5_

- [x] 10. Implement MetricsTracker component
  - [x] 10.1 Implement MetricsTracker class
    - Implement `track()` persisting metrics to PostgreSQL
    - Implement `getAggregated()` with groupBy support
    - Implement `getTotalCost()` for time range
    - Implement `cleanup()` removing metrics older than retention period
    - Add in-memory queue (max 1000) for database unavailability
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 10.2 Write property test for Property 14: Metrics Contain Required Fields
    - **Property 14: Metrics Contain Required Fields**
    - Every recorded metric SHALL contain: provider, model, complexity, inputTokens, outputTokens, latencyMs, success
    - **Validates: Requirements 6.1**

  - [x] 10.3 Write property test for Property 15: Cost Calculation Accuracy
    - **Property 15: Cost Calculation Accuracy**
    - Estimated cost SHALL equal: (inputTokens/1000 * inputCost) + (outputTokens/1000 * outputCost)
    - **Validates: Requirements 6.2**

  - [x] 10.4 Write unit tests for MetricsTracker
    - Test cost calculation with known values
    - Test aggregation grouping by provider/model/complexity
    - Test time range filtering
    - Test retention cleanup removes old records
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

- [x] 11. Checkpoint - Verify database schema and MetricsTracker
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement core ModelRouter class
  - [x] 12.1 Implement ModelRouter class
    - Inject TaskClassifier, ModelRegistry, FallbackStrategy, MetricsTracker, ProviderHealthChecker
    - Implement `selectModel()` coordinating classification and selection
    - Implement `handleFailure()` delegating to FallbackStrategy
    - Implement `recordExecution()` delegating to MetricsTracker
    - Implement `isAvailable()` checking component health
    - Apply agent overrides when configured
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 8.2, 8.3, 8.5_

  - [x] 12.2 Write property test for Property 6: Model Selection Priority
    - **Property 6: Model Selection Priority**
    - Selected model SHALL: exist in registry for complexity level, prefer configured provider with valid API key, follow cost-efficiency ordering
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 12.3 Write property test for Property 7: API Key Availability Affects Selection
    - **Property 7: API Key Availability Affects Selection**
    - If preferred provider lacks API key, SHALL select from alternative provider
    - Models from providers without API keys SHALL never be selected
    - **Validates: Requirements 3.4, 3.5**

  - [x] 12.4 Write property test for Property 13: Model Selection Result Format
    - **Property 13: Model Selection Result Format**
    - Successful selection SHALL contain: valid provider, non-empty model name, non-negative cost
    - **Validates: Requirements 5.3**

  - [x] 12.5 Write property test for Property 17: Agent Override Application
    - **Property 17: Agent Override Application**
    - Agents with overrides SHALL use override instead of complexity-based selection
    - Minimum complexity overrides SHALL elevate lower classifications
    - **Validates: Requirements 8.2, 8.3**

  - [x] 12.6 Write unit tests for ModelRouter
    - Test model selection for each complexity level
    - Test provider preference with valid API key
    - Test fallback to alternative provider when preferred unavailable
    - Test agent override application for coordinator and architect
    - _Requirements: 3.1, 3.2, 3.4, 8.2, 8.4_

- [x] 13. Checkpoint - Verify ModelRouter core functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Integrate ModelRouter with BaseAgent
  - [x] 14.1 Update BaseAgent to use ModelRouter
    - Add ModelRouter dependency to BaseAgent constructor
    - Modify `callLLMAPI()` to request model selection from ModelRouter
    - Use selected provider and model for API call
    - Record execution metrics after API call completes
    - Implement fallback to default model when ModelRouter unavailable
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 14.2 Write integration tests for BaseAgent with ModelRouter
    - Test BaseAgent calls ModelRouter.selectModel()
    - Test BaseAgent uses returned model/provider
    - Test fallback to default when ModelRouter unavailable
    - Test metrics recorded after successful execution
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [x] 15. Add configuration support
  - [x] 15.1 Create ModelRouter configuration schema
    - Create `src/model-router/config-schema.ts` with `ModelRouterConfig` interface
    - Include modelMappings, agentOverrides, providerKeys, classificationCriteria, fallback settings, healthCheck settings, metrics settings
    - _Requirements: 2.4, 7.1_

  - [x] 15.2 Update config/index.ts for OpenAI API key
    - Add `OPENAI_API_KEY` to config module
    - _Requirements: 7.1_

  - [x] 15.3 Create ModelRouter factory function
    - Create factory that initializes all components with configuration
    - Read API keys from environment variables
    - Apply default configurations
    - _Requirements: 7.1, 7.2_

- [x] 16. Add module exports and documentation
  - [x] 16.1 Update src/model-router/index.ts exports
    - Export all public interfaces and classes
    - Export factory function
    - Export default configurations
    - _Requirements: 5.1_

  - [x] 16.2 Add JSDoc documentation to public APIs
    - Document ModelRouter public methods
    - Document configuration options
    - Add usage examples in comments
    - _Requirements: 5.1_

- [x] 17. Final checkpoint - Run all tests
  - All 874 tests pass (485 model-router tests + 389 other tests)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript with ES modules (.js extensions in imports)
- Uses vitest for testing and fast-check for property-based testing
- Uses Drizzle ORM for PostgreSQL persistence
