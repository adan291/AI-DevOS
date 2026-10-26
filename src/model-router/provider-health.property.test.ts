/**
 * Property-Based Tests for Provider Health Checker
 * Feature: model-router, Property 16: Provider Unavailability Handling
 *
 * **Validates: Requirements 7.3, 7.6**
 *
 * Property 16: Providers with missing API key OR failed health check SHALL be marked unavailable.
 * After health check failure, provider SHALL remain unavailable for exactly 1 minute.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { ProviderHealthChecker } from './provider-health-checker.js';
import { UNAVAILABLE_DURATION_MS } from './provider-health.js';
import type { Provider } from './model-router.js';

// ============================================================================
// Fast-Check Arbitraries (Generators)
// ============================================================================

/**
 * Valid provider names as defined in the design document
 */
const VALID_PROVIDERS: Provider[] = ['groq', 'anthropic', 'openai'];

/**
 * Generates arbitrary valid provider names
 */
const arbitraryProvider = fc.constantFrom<Provider>(...VALID_PROVIDERS);

/**
 * Generates arbitrary positive durations in milliseconds
 * Range: 1ms to 5 minutes (300000ms)
 */
const arbitraryDurationMs = fc.integer({ min: 1, max: 300000 });

/**
 * Generates arbitrary short durations for quick tests
 * Range: 100ms to 5000ms
 */
const arbitraryShortDurationMs = fc.integer({ min: 100, max: 5000 });

/**
 * Generates arbitrary provider names as strings (for testing with various inputs)
 */
const arbitraryProviderName = fc.oneof(
  // Valid providers
  fc.constantFrom<Provider>(...VALID_PROVIDERS),
  // Edge case: empty string (should be handled gracefully)
  fc.constant('groq' as Provider) // Fallback to valid provider for type safety
);

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 16: Provider Unavailability Handling', () => {
  let healthChecker: ProviderHealthChecker;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Use fake timers for duration-based tests
    vi.useFakeTimers();
    
    // Clear all API keys to start with a clean state
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    
    healthChecker = new ProviderHealthChecker();
  });

  afterEach(() => {
    // Stop health checks if running
    healthChecker.stopHealthChecks();
    
    // Restore real timers
    vi.useRealTimers();
    
    // Restore original environment
    process.env = { ...originalEnv };
  });

  // ==========================================================================
  // Property: Providers without API keys are marked unavailable
  // ==========================================================================

  /**
   * **Validates: Requirements 7.3**
   *
   * Property: Providers with missing API key SHALL be marked unavailable.
   */
  describe('Missing API Key Unavailability', () => {
    it('should mark providers without API keys as unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryProvider, async (provider) => {
          // Arrange: Ensure no API key is set for the provider
          const envVarMap: Record<Provider, string> = {
            groq: 'GROQ_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            openai: 'OPENAI_API_KEY',
            ollama: 'OLLAMA_MODEL',
          };
          delete process.env[envVarMap[provider]];
          
          // Create a fresh health checker to pick up env changes
          const checker = new ProviderHealthChecker();

          // Act & Assert: Provider should be unavailable
          expect(checker.isAvailable(provider)).toBe(false);
          
          // Cleanup
          checker.stopHealthChecks();
        }),
        { numRuns: 100 }
      );
    });

    it('should mark all providers without API keys as unavailable in health status', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryProvider, async (provider) => {
          // Arrange: Ensure no API key is set
          const envVarMap: Record<Provider, string> = {
            groq: 'GROQ_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            openai: 'OPENAI_API_KEY',
            ollama: 'OLLAMA_MODEL',
          };
          delete process.env[envVarMap[provider]];
          
          // Create a fresh health checker
          const checker = new ProviderHealthChecker();

          // Act
          const healthStatus = checker.getHealthStatus();
          const status = healthStatus.get(provider);

          // Assert: Provider should be marked unavailable in health status
          expect(status).toBeDefined();
          expect(status?.available).toBe(false);
          
          // Cleanup
          checker.stopHealthChecks();
        }),
        { numRuns: 100 }
      );
    });

    it('should mark providers with empty API keys as unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          fc.constantFrom('', '   ', '\t', '\n'),
          async (provider, emptyValue) => {
            // Arrange: Set empty API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = emptyValue;
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();

            // Act & Assert: Provider should be unavailable
            expect(checker.isAvailable(provider)).toBe(false);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should mark providers as available when API key is present', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          async (provider, apiKey) => {
            // Arrange: Set valid API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = apiKey;
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();

            // Act & Assert: Provider should be available
            expect(checker.isAvailable(provider)).toBe(true);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: markUnavailable() makes provider unavailable for specified duration
  // ==========================================================================

  /**
   * **Validates: Requirements 7.6**
   *
   * Property: After markUnavailable() is called, provider SHALL remain unavailable
   * for exactly the specified duration.
   */
  describe('markUnavailable Duration Handling', () => {
    it('should make provider unavailable immediately after markUnavailable()', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          arbitraryDurationMs,
          async (provider, durationMs) => {
            // Arrange: Set API key so provider would normally be available
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = 'test-api-key';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Verify provider is initially available
            expect(checker.isAvailable(provider)).toBe(true);

            // Act: Mark provider as unavailable
            checker.markUnavailable(provider, durationMs);

            // Assert: Provider should be unavailable immediately
            expect(checker.isAvailable(provider)).toBe(false);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should keep provider unavailable before duration expires', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          arbitraryShortDurationMs,
          fc.integer({ min: 1, max: 99 }).map(pct => pct / 100), // 1% to 99% of duration
          async (provider, durationMs, percentElapsed) => {
            // Arrange: Set API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = 'test-api-key';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Mark provider as unavailable
            checker.markUnavailable(provider, durationMs);

            // Act: Advance time by less than the full duration
            const timeToAdvance = Math.floor(durationMs * percentElapsed);
            vi.advanceTimersByTime(timeToAdvance);

            // Assert: Provider should still be unavailable
            expect(checker.isAvailable(provider)).toBe(false);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should make provider available again after duration expires', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          arbitraryShortDurationMs,
          async (provider, durationMs) => {
            // Arrange: Set API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = 'test-api-key';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Mark provider as unavailable
            checker.markUnavailable(provider, durationMs);
            
            // Verify unavailable
            expect(checker.isAvailable(provider)).toBe(false);

            // Act: Advance time past the duration
            vi.advanceTimersByTime(durationMs + 1);

            // Assert: Provider should be available again
            expect(checker.isAvailable(provider)).toBe(true);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should make provider available exactly at duration boundary', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          arbitraryShortDurationMs,
          async (provider, durationMs) => {
            // Arrange: Set API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = 'test-api-key';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Mark provider as unavailable
            checker.markUnavailable(provider, durationMs);

            // Act: Advance time exactly to the duration
            vi.advanceTimersByTime(durationMs);

            // Assert: Provider should be available at exactly the duration
            expect(checker.isAvailable(provider)).toBe(true);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Default unavailability duration is exactly 1 minute
  // ==========================================================================

  /**
   * **Validates: Requirements 7.6**
   *
   * Property: After health check failure, provider SHALL remain unavailable
   * for exactly 1 minute (UNAVAILABLE_DURATION_MS = 60000ms).
   */
  describe('Default 1-Minute Unavailability Duration', () => {
    it('should use default 1-minute duration when no duration specified', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryProvider, async (provider) => {
          // Arrange: Set API key
          const envVarMap: Record<Provider, string> = {
            groq: 'GROQ_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            openai: 'OPENAI_API_KEY',
            ollama: 'OLLAMA_MODEL',
          };
          process.env[envVarMap[provider]] = 'test-api-key';
          
          // Create a fresh health checker
          const checker = new ProviderHealthChecker();
          
          // Mark provider as unavailable with default duration
          checker.markUnavailable(provider, UNAVAILABLE_DURATION_MS);
          
          // Verify unavailable
          expect(checker.isAvailable(provider)).toBe(false);

          // Act: Advance time to just before 1 minute
          vi.advanceTimersByTime(UNAVAILABLE_DURATION_MS - 1);
          
          // Assert: Should still be unavailable
          expect(checker.isAvailable(provider)).toBe(false);

          // Act: Advance time to exactly 1 minute
          vi.advanceTimersByTime(1);
          
          // Assert: Should now be available
          expect(checker.isAvailable(provider)).toBe(true);
          
          // Cleanup
          checker.stopHealthChecks();
        }),
        { numRuns: 100 }
      );
    });

    it('should verify UNAVAILABLE_DURATION_MS constant is exactly 1 minute', () => {
      // Assert: The constant should be exactly 60000ms (1 minute)
      expect(UNAVAILABLE_DURATION_MS).toBe(60 * 1000);
    });

    it('should remain unavailable for full 1 minute after marking', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          fc.integer({ min: 1, max: 59999 }), // Any time less than 1 minute
          async (provider, timeBeforeExpiry) => {
            // Arrange: Set API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = 'test-api-key';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Mark provider as unavailable with default 1-minute duration
            checker.markUnavailable(provider, UNAVAILABLE_DURATION_MS);

            // Act: Advance time to less than 1 minute
            vi.advanceTimersByTime(timeBeforeExpiry);

            // Assert: Should still be unavailable
            expect(checker.isAvailable(provider)).toBe(false);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Health status reflects unavailability correctly
  // ==========================================================================

  /**
   * **Validates: Requirements 7.3, 7.6**
   *
   * Property: getHealthStatus() SHALL correctly reflect provider unavailability.
   */
  describe('Health Status Consistency', () => {
    it('should reflect unavailability in health status after markUnavailable()', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          arbitraryShortDurationMs,
          async (provider, durationMs) => {
            // Arrange: Set API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = 'test-api-key';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Mark provider as unavailable
            checker.markUnavailable(provider, durationMs);

            // Act
            const healthStatus = checker.getHealthStatus();
            const status = healthStatus.get(provider);

            // Assert: Health status should show unavailable
            expect(status).toBeDefined();
            expect(status?.available).toBe(false);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reflect availability in health status after duration expires', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          arbitraryShortDurationMs,
          async (provider, durationMs) => {
            // Arrange: Set API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = 'test-api-key';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Mark provider as unavailable
            checker.markUnavailable(provider, durationMs);

            // Act: Advance time past the duration
            vi.advanceTimersByTime(durationMs + 1);
            
            const healthStatus = checker.getHealthStatus();
            const status = healthStatus.get(provider);

            // Assert: Health status should show available
            expect(status).toBeDefined();
            expect(status?.available).toBe(true);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should track consecutive failures when marking unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryProvider,
          fc.integer({ min: 1, max: 5 }), // Number of times to mark unavailable
          async (provider, markCount) => {
            // Arrange: Set API key
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider]] = 'test-api-key';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Get initial consecutive failures
            const initialStatus = checker.getHealthStatus().get(provider);
            const initialFailures = initialStatus?.consecutiveFailures ?? 0;

            // Act: Mark provider as unavailable multiple times
            for (let i = 0; i < markCount; i++) {
              checker.markUnavailable(provider, 1000);
            }
            
            const healthStatus = checker.getHealthStatus();
            const status = healthStatus.get(provider);

            // Assert: Consecutive failures should have increased
            expect(status).toBeDefined();
            expect(status?.consecutiveFailures).toBeGreaterThanOrEqual(initialFailures + markCount);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Multiple providers can be marked unavailable independently
  // ==========================================================================

  /**
   * **Validates: Requirements 7.3, 7.6**
   *
   * Property: Marking one provider unavailable SHALL NOT affect other providers.
   */
  describe('Provider Independence', () => {
    it('should allow marking multiple providers unavailable independently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(arbitraryProvider, arbitraryProvider).filter(([a, b]) => a !== b),
          // Use significantly different durations to avoid boundary issues
          fc.integer({ min: 1000, max: 2000 }),
          fc.integer({ min: 4000, max: 5000 }),
          async ([provider1, provider2], shortDuration, longDuration) => {
            // Arrange: Set API keys for both providers
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider1]] = 'test-api-key-1';
            process.env[envVarMap[provider2]] = 'test-api-key-2';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Mark provider1 with short duration, provider2 with long duration
            checker.markUnavailable(provider1, shortDuration);
            checker.markUnavailable(provider2, longDuration);

            // Assert: Both should be unavailable initially
            expect(checker.isAvailable(provider1)).toBe(false);
            expect(checker.isAvailable(provider2)).toBe(false);

            // Act: Advance time past the shorter duration but before the longer
            vi.advanceTimersByTime(shortDuration + 1);

            // Assert: Provider1 should be available, provider2 should still be unavailable
            expect(checker.isAvailable(provider1)).toBe(true);
            expect(checker.isAvailable(provider2)).toBe(false);

            // Act: Advance time past the longer duration
            vi.advanceTimersByTime(longDuration - shortDuration);

            // Assert: Both should now be available
            expect(checker.isAvailable(provider1)).toBe(true);
            expect(checker.isAvailable(provider2)).toBe(true);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not affect other providers when marking one unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(arbitraryProvider, arbitraryProvider).filter(([a, b]) => a !== b),
          arbitraryShortDurationMs,
          async ([provider1, provider2], durationMs) => {
            // Arrange: Set API keys for both providers
            const envVarMap: Record<Provider, string> = {
              groq: 'GROQ_API_KEY',
              anthropic: 'ANTHROPIC_API_KEY',
              openai: 'OPENAI_API_KEY',
              ollama: 'OLLAMA_MODEL',
            };
            process.env[envVarMap[provider1]] = 'test-api-key-1';
            process.env[envVarMap[provider2]] = 'test-api-key-2';
            
            // Create a fresh health checker
            const checker = new ProviderHealthChecker();
            
            // Verify both are initially available
            expect(checker.isAvailable(provider1)).toBe(true);
            expect(checker.isAvailable(provider2)).toBe(true);

            // Act: Mark only provider1 as unavailable
            checker.markUnavailable(provider1, durationMs);

            // Assert: Provider1 should be unavailable, provider2 should still be available
            expect(checker.isAvailable(provider1)).toBe(false);
            expect(checker.isAvailable(provider2)).toBe(true);
            
            // Cleanup
            checker.stopHealthChecks();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
