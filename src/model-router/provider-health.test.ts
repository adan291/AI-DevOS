/**
 * Unit Tests for Provider Health Checker
 * 
 * Example-based tests that verify specific known inputs and expected outputs.
 * Tests API key validation, health check failures, recovery timing, and periodic checks.
 * 
 * Requirements: 7.1, 7.3, 7.5, 7.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProviderHealthChecker } from './provider-health-checker.js';
import { HEALTH_CHECK_INTERVAL_MS, UNAVAILABLE_DURATION_MS } from './provider-health.js';
import type { Provider } from './model-router.js';

describe('ProviderHealthChecker', () => {
  let checker: ProviderHealthChecker;
  const originalEnv = process.env;

  beforeEach(() => {
    // Use fake timers for duration-based tests
    vi.useFakeTimers();
    
    // Reset environment variables
    process.env = { ...originalEnv };
    
    // Clear all API keys by default
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    // Stop health checks if running
    checker?.stopHealthChecks();
    
    // Restore real timers
    vi.useRealTimers();
    
    // Restore original environment
    process.env = originalEnv;
  });

  // ==========================================================================
  // Requirement 7.1, 7.3: Provider Unavailable When API Key Missing
  // ==========================================================================
  describe('Provider Unavailable When API Key Missing', () => {
    it('should mark provider as unavailable when API key is missing', () => {
      checker = new ProviderHealthChecker();
      
      expect(checker.isAvailable('groq')).toBe(false);
      expect(checker.isAvailable('anthropic')).toBe(false);
      expect(checker.isAvailable('openai')).toBe(false);
    });

    it('should mark provider as available when API key is present', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      
      checker = new ProviderHealthChecker();
      
      expect(checker.isAvailable('groq')).toBe(true);
      expect(checker.isAvailable('anthropic')).toBe(true);
      expect(checker.isAvailable('openai')).toBe(false);
    });

    it('should treat empty string API key as missing', () => {
      process.env.GROQ_API_KEY = '';
      
      checker = new ProviderHealthChecker();
      
      expect(checker.isAvailable('groq')).toBe(false);
    });

    it('should treat whitespace-only API key as missing', () => {
      process.env.GROQ_API_KEY = '   ';
      
      checker = new ProviderHealthChecker();
      
      expect(checker.isAvailable('groq')).toBe(false);
    });

    it('should include error message for missing API key in health status', () => {
      checker = new ProviderHealthChecker();
      
      const status = checker.getHealthStatus();
      const groqStatus = status.get('groq');
      
      expect(groqStatus?.lastError).toContain('Missing API key');
      expect(groqStatus?.lastError).toContain('GROQ_API_KEY');
    });

    it('should have consecutiveFailures > 0 for missing API key', () => {
      checker = new ProviderHealthChecker();
      
      const status = checker.getHealthStatus();
      const groqStatus = status.get('groq');
      
      expect(groqStatus?.consecutiveFailures).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Requirement 7.3, 7.6: Health Check Failure Marks Provider Unavailable
  // ==========================================================================
  describe('Health Check Failure Marks Provider Unavailable', () => {
    it('should mark provider as unavailable when markUnavailable is called', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      expect(checker.isAvailable('groq')).toBe(true);
      
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      
      expect(checker.isAvailable('groq')).toBe(false);
    });

    it('should update health status when provider is marked unavailable', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('anthropic', UNAVAILABLE_DURATION_MS);
      
      const status = checker.getHealthStatus();
      const anthropicStatus = status.get('anthropic');
      
      expect(anthropicStatus?.available).toBe(false);
    });

    it('should increment consecutiveFailures when marked unavailable', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      const initialStatus = checker.getHealthStatus().get('openai');
      const initialFailures = initialStatus?.consecutiveFailures ?? 0;
      
      checker.markUnavailable('openai', UNAVAILABLE_DURATION_MS);
      
      const newStatus = checker.getHealthStatus().get('openai');
      expect(newStatus?.consecutiveFailures).toBe(initialFailures + 1);
    });

    it('should set lastError when provider is marked unavailable', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      
      const status = checker.getHealthStatus().get('groq');
      expect(status?.lastError).toContain('Marked unavailable');
    });

    it('should update lastCheck timestamp when marked unavailable', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      const beforeMark = new Date();
      vi.advanceTimersByTime(1000);
      
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      
      const status = checker.getHealthStatus().get('groq');
      expect(status?.lastCheck.getTime()).toBeGreaterThanOrEqual(beforeMark.getTime());
    });
  });

  // ==========================================================================
  // Requirement 7.6: Provider Becomes Available After 1 Minute
  // ==========================================================================
  describe('Provider Becomes Available After 1 Minute', () => {
    it('should remain unavailable before 1 minute has passed', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      
      // Advance time by 59 seconds (just under 1 minute)
      vi.advanceTimersByTime(59 * 1000);
      
      expect(checker.isAvailable('groq')).toBe(false);
    });

    it('should become available after exactly 1 minute', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      
      // Advance time by exactly 1 minute
      vi.advanceTimersByTime(UNAVAILABLE_DURATION_MS);
      
      expect(checker.isAvailable('groq')).toBe(true);
    });

    it('should become available after more than 1 minute', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('anthropic', UNAVAILABLE_DURATION_MS);
      
      // Advance time by 2 minutes
      vi.advanceTimersByTime(2 * 60 * 1000);
      
      expect(checker.isAvailable('anthropic')).toBe(true);
    });

    it('should reset consecutiveFailures after recovery', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('openai', UNAVAILABLE_DURATION_MS);
      
      // Advance time past unavailability period
      vi.advanceTimersByTime(UNAVAILABLE_DURATION_MS + 1000);
      
      // Trigger availability check which should reset failures
      checker.isAvailable('openai');
      
      const status = checker.getHealthStatus().get('openai');
      expect(status?.consecutiveFailures).toBe(0);
    });

    it('should update health status to available after recovery', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      
      // Advance time past unavailability period
      vi.advanceTimersByTime(UNAVAILABLE_DURATION_MS + 1000);
      
      // Trigger availability check
      checker.isAvailable('groq');
      
      const status = checker.getHealthStatus().get('groq');
      expect(status?.available).toBe(true);
    });

    it('should support custom unavailability duration', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      const customDuration = 30 * 1000; // 30 seconds
      checker.markUnavailable('groq', customDuration);
      
      // Should still be unavailable at 29 seconds
      vi.advanceTimersByTime(29 * 1000);
      expect(checker.isAvailable('groq')).toBe(false);
      
      // Should be available at 30 seconds
      vi.advanceTimersByTime(1000);
      expect(checker.isAvailable('groq')).toBe(true);
    });

    it('should use default duration when not specified', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('groq');
      
      // Should still be unavailable just before default duration
      vi.advanceTimersByTime(UNAVAILABLE_DURATION_MS - 1000);
      expect(checker.isAvailable('groq')).toBe(false);
      
      // Should be available at default duration
      vi.advanceTimersByTime(1000);
      expect(checker.isAvailable('groq')).toBe(true);
    });
  });

  // ==========================================================================
  // Requirement 7.5: Periodic Health Checks Run on Interval
  // ==========================================================================
  describe('Periodic Health Checks Run on Interval', () => {
    it('should run initial health check when startHealthChecks is called', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      const initialLastCheck = checker.getHealthStatus().get('groq')?.lastCheck;
      
      vi.advanceTimersByTime(1000);
      checker.startHealthChecks(HEALTH_CHECK_INTERVAL_MS);
      
      const newLastCheck = checker.getHealthStatus().get('groq')?.lastCheck;
      expect(newLastCheck?.getTime()).toBeGreaterThanOrEqual(initialLastCheck?.getTime() ?? 0);
    });

    it('should run health check at specified interval', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.startHealthChecks(HEALTH_CHECK_INTERVAL_MS);
      
      const firstCheck = checker.getHealthStatus().get('anthropic')?.lastCheck;
      
      // Advance time by one interval
      vi.advanceTimersByTime(HEALTH_CHECK_INTERVAL_MS);
      
      const secondCheck = checker.getHealthStatus().get('anthropic')?.lastCheck;
      expect(secondCheck?.getTime()).toBeGreaterThan(firstCheck?.getTime() ?? 0);
    });

    it('should run multiple health checks over time', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.startHealthChecks(HEALTH_CHECK_INTERVAL_MS);
      
      const timestamps: number[] = [];
      timestamps.push(checker.getHealthStatus().get('openai')?.lastCheck?.getTime() ?? 0);
      
      // Advance through 3 intervals
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(HEALTH_CHECK_INTERVAL_MS);
        timestamps.push(checker.getHealthStatus().get('openai')?.lastCheck?.getTime() ?? 0);
      }
      
      // Each timestamp should be greater than the previous
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
      }
    });

    it('should stop health checks when stopHealthChecks is called', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.startHealthChecks(HEALTH_CHECK_INTERVAL_MS);
      
      // Advance one interval
      vi.advanceTimersByTime(HEALTH_CHECK_INTERVAL_MS);
      const checkAfterStart = checker.getHealthStatus().get('groq')?.lastCheck;
      
      // Stop health checks
      checker.stopHealthChecks();
      
      // Advance another interval
      vi.advanceTimersByTime(HEALTH_CHECK_INTERVAL_MS);
      const checkAfterStop = checker.getHealthStatus().get('groq')?.lastCheck;
      
      // Timestamp should not have changed after stopping
      expect(checkAfterStop?.getTime()).toBe(checkAfterStart?.getTime());
    });

    it('should support custom health check interval', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      const customInterval = 30 * 1000; // 30 seconds
      checker.startHealthChecks(customInterval);
      
      const firstCheck = checker.getHealthStatus().get('groq')?.lastCheck;
      
      // Advance by custom interval
      vi.advanceTimersByTime(customInterval);
      
      const secondCheck = checker.getHealthStatus().get('groq')?.lastCheck;
      expect(secondCheck?.getTime()).toBeGreaterThan(firstCheck?.getTime() ?? 0);
    });

    it('should stop existing health checks when starting new ones', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      // Start with one interval
      checker.startHealthChecks(60 * 1000);
      
      // Start with a different interval (should stop the first)
      checker.startHealthChecks(30 * 1000);
      
      const firstCheck = checker.getHealthStatus().get('groq')?.lastCheck;
      
      // Advance by the new interval
      vi.advanceTimersByTime(30 * 1000);
      
      const secondCheck = checker.getHealthStatus().get('groq')?.lastCheck;
      expect(secondCheck?.getTime()).toBeGreaterThan(firstCheck?.getTime() ?? 0);
    });

    it('should recover provider during periodic health check', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      // Mark provider unavailable
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      expect(checker.isAvailable('groq')).toBe(false);
      
      // Start health checks
      checker.startHealthChecks(HEALTH_CHECK_INTERVAL_MS);
      
      // Advance past unavailability period and to next health check
      vi.advanceTimersByTime(UNAVAILABLE_DURATION_MS + HEALTH_CHECK_INTERVAL_MS);
      
      // Provider should be recovered
      expect(checker.isAvailable('groq')).toBe(true);
    });
  });

  // ==========================================================================
  // getHealthStatus Method
  // ==========================================================================
  describe('getHealthStatus Method', () => {
    it('should return status for all providers', () => {
      checker = new ProviderHealthChecker();
      
      const status = checker.getHealthStatus();
      
      expect(status.has('groq')).toBe(true);
      expect(status.has('anthropic')).toBe(true);
      expect(status.has('openai')).toBe(true);
    });

    it('should return a copy of the status map', () => {
      checker = new ProviderHealthChecker();
      
      const status1 = checker.getHealthStatus();
      const status2 = checker.getHealthStatus();
      
      expect(status1).not.toBe(status2);
    });

    it('should include all required fields in health status', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      const status = checker.getHealthStatus().get('groq');
      
      expect(status).toHaveProperty('provider');
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('lastCheck');
      expect(status).toHaveProperty('consecutiveFailures');
    });

    it('should reflect current API key availability', () => {
      // Start without API key
      checker = new ProviderHealthChecker();
      expect(checker.getHealthStatus().get('groq')?.available).toBe(false);
      
      // Add API key and create new checker
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      expect(checker.getHealthStatus().get('groq')?.available).toBe(true);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle marking same provider unavailable multiple times', () => {
      process.env.GROQ_API_KEY = 'test-key';
      checker = new ProviderHealthChecker();
      
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      checker.markUnavailable('groq', UNAVAILABLE_DURATION_MS);
      
      const status = checker.getHealthStatus().get('groq');
      expect(status?.consecutiveFailures).toBe(3);
    });

    it('should handle all providers being unavailable', () => {
      checker = new ProviderHealthChecker();
      
      expect(checker.isAvailable('groq')).toBe(false);
      expect(checker.isAvailable('anthropic')).toBe(false);
      expect(checker.isAvailable('openai')).toBe(false);
    });

    it('should handle all providers being available', () => {
      process.env.GROQ_API_KEY = 'test-key';
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'test-key';
      
      checker = new ProviderHealthChecker();
      
      expect(checker.isAvailable('groq')).toBe(true);
      expect(checker.isAvailable('anthropic')).toBe(true);
      expect(checker.isAvailable('openai')).toBe(true);
    });

    it('should handle stopHealthChecks when no health checks are running', () => {
      checker = new ProviderHealthChecker();
      
      // Should not throw
      expect(() => checker.stopHealthChecks()).not.toThrow();
    });

    it('should handle calling stopHealthChecks multiple times', () => {
      checker = new ProviderHealthChecker();
      checker.startHealthChecks(HEALTH_CHECK_INTERVAL_MS);
      
      // Should not throw
      expect(() => {
        checker.stopHealthChecks();
        checker.stopHealthChecks();
        checker.stopHealthChecks();
      }).not.toThrow();
    });
  });
});
