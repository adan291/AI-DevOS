/**
 * Provider Health Checker Types
 * 
 * Monitors provider health and availability for the Model Router.
 * Handles API key validation and health check failures.
 */

import type { Provider } from './model-router.js';

/** Provider health status */
export interface ProviderHealth {
  provider: Provider;
  available: boolean;
  lastCheck: Date;
  lastError?: string;
  consecutiveFailures: number;
}

/** Provider Health Checker interface */
export interface IProviderHealthChecker {
  /**
   * Check if a provider is currently available.
   */
  isAvailable(provider: Provider): boolean;

  /**
   * Get health status for all providers.
   */
  getHealthStatus(): Map<Provider, ProviderHealth>;

  /**
   * Mark a provider as temporarily unavailable.
   */
  markUnavailable(provider: Provider, durationMs: number): void;

  /**
   * Start periodic health checks.
   */
  startHealthChecks(intervalMs: number): void;

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void;
}

/** Health check interval in milliseconds (5 minutes) */
export const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Unavailability duration after health check failure (1 minute) */
export const UNAVAILABLE_DURATION_MS = 60 * 1000;
