/**
 * Provider Health Checker Implementation
 * 
 * Monitors provider health and availability for the Model Router.
 * Handles API key validation and health check failures.
 */

import type { Provider } from './model-router.js';
import type { ProviderHealth, IProviderHealthChecker } from './provider-health.js';
import { HEALTH_CHECK_INTERVAL_MS, UNAVAILABLE_DURATION_MS } from './provider-health.js';

/**
 * Environment variable that enables each provider. Ollama runs locally and
 * needs no key, so it is enabled by naming the model to use.
 */
const PROVIDER_API_KEY_ENV_VARS: Record<Provider, string> = {
  groq: 'GROQ_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  ollama: 'OLLAMA_MODEL',
};

/** All supported providers */
const ALL_PROVIDERS: Provider[] = ['groq', 'anthropic', 'openai', 'ollama'];

/**
 * ProviderHealthChecker Implementation
 * 
 * Monitors provider health and availability.
 * Checks API key presence and tracks health status.
 * Supports marking providers as temporarily unavailable with automatic recovery.
 * 
 * @implements {IProviderHealthChecker}
 */
export class ProviderHealthChecker implements IProviderHealthChecker {
  private healthStatus: Map<Provider, ProviderHealth>;
  private unavailableUntil: Map<Provider, Date>;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.healthStatus = new Map();
    this.unavailableUntil = new Map();

    // Initialize health status for all providers
    this.initializeHealthStatus();
  }

  /**
   * Initialize health status for all providers.
   * Checks API key availability on startup.
   */
  private initializeHealthStatus(): void {
    for (const provider of ALL_PROVIDERS) {
      const hasApiKey = this.hasApiKey(provider);
      this.healthStatus.set(provider, {
        provider,
        available: hasApiKey,
        lastCheck: new Date(),
        lastError: hasApiKey ? undefined : `Missing API key: ${PROVIDER_API_KEY_ENV_VARS[provider]}`,
        consecutiveFailures: hasApiKey ? 0 : 1,
      });
    }
  }

  /**
   * Check if a provider has an API key configured.
   */
  private hasApiKey(provider: Provider): boolean {
    const envVar = PROVIDER_API_KEY_ENV_VARS[provider];
    const apiKey = process.env[envVar];
    return !!apiKey && apiKey.trim().length > 0;
  }

  /**
   * Check if a provider is currently available.
   * A provider is available if:
   * 1. It has a valid API key
   * 2. It is not marked as temporarily unavailable
   * 3. Its health status shows it as available
   */
  isAvailable(provider: Provider): boolean {
    // Check if provider has API key
    if (!this.hasApiKey(provider)) {
      return false;
    }

    // Check if provider is temporarily unavailable
    const unavailableUntil = this.unavailableUntil.get(provider);
    if (unavailableUntil && new Date() < unavailableUntil) {
      return false;
    }

    // If the unavailable period has passed, clear it
    if (unavailableUntil && new Date() >= unavailableUntil) {
      this.unavailableUntil.delete(provider);
      // Update health status to available
      const status = this.healthStatus.get(provider);
      if (status) {
        status.available = true;
        status.consecutiveFailures = 0;
        status.lastCheck = new Date();
      }
    }

    // Check health status
    const status = this.healthStatus.get(provider);
    return status?.available ?? false;
  }

  /**
   * Get health status for all providers.
   */
  getHealthStatus(): Map<Provider, ProviderHealth> {
    // Update availability based on current state before returning
    for (const provider of ALL_PROVIDERS) {
      const status = this.healthStatus.get(provider);
      if (status) {
        // Re-check API key availability
        const hasApiKey = this.hasApiKey(provider);
        
        // Check if temporarily unavailable period has passed
        const unavailableUntil = this.unavailableUntil.get(provider);
        const isTemporarilyUnavailable = unavailableUntil && new Date() < unavailableUntil;

        // Update status
        if (!hasApiKey) {
          status.available = false;
          status.lastError = `Missing API key: ${PROVIDER_API_KEY_ENV_VARS[provider]}`;
        } else if (isTemporarilyUnavailable) {
          status.available = false;
        } else if (!status.available && hasApiKey) {
          // Provider was unavailable but now has API key and is not temporarily unavailable
          status.available = true;
          status.consecutiveFailures = 0;
        }
      }
    }

    // Return a copy of the map
    return new Map(this.healthStatus);
  }

  /**
   * Mark a provider as temporarily unavailable.
   * The provider will automatically become available again after the specified duration.
   * 
   * @param provider - The provider to mark as unavailable
   * @param durationMs - Duration in milliseconds before the provider becomes available again
   */
  markUnavailable(provider: Provider, durationMs: number = UNAVAILABLE_DURATION_MS): void {
    const unavailableUntil = new Date(Date.now() + durationMs);
    this.unavailableUntil.set(provider, unavailableUntil);

    // Update health status
    const status = this.healthStatus.get(provider);
    if (status) {
      status.available = false;
      status.lastCheck = new Date();
      status.consecutiveFailures += 1;
      status.lastError = `Marked unavailable until ${unavailableUntil.toISOString()}`;
    }
  }

  /**
   * Start periodic health checks.
   * Health checks verify API key availability and update provider status.
   * 
   * @param intervalMs - Interval between health checks in milliseconds (default: 5 minutes)
   */
  startHealthChecks(intervalMs: number = HEALTH_CHECK_INTERVAL_MS): void {
    // Stop any existing health checks
    this.stopHealthChecks();

    // Run initial health check
    this.performHealthCheck();

    // Start periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
  }

  /**
   * Stop periodic health checks.
   * Cleans up the interval timer.
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Perform a health check for all providers.
   * Updates health status based on API key availability and temporary unavailability.
   */
  private performHealthCheck(): void {
    const now = new Date();

    for (const provider of ALL_PROVIDERS) {
      const hasApiKey = this.hasApiKey(provider);
      const status = this.healthStatus.get(provider);

      if (!status) {
        continue;
      }

      // Check if temporarily unavailable period has passed
      const unavailableUntil = this.unavailableUntil.get(provider);
      const isTemporarilyUnavailable = unavailableUntil && now < unavailableUntil;

      // Clear expired unavailability
      if (unavailableUntil && now >= unavailableUntil) {
        this.unavailableUntil.delete(provider);
      }

      // Update status
      status.lastCheck = now;

      if (!hasApiKey) {
        status.available = false;
        status.lastError = `Missing API key: ${PROVIDER_API_KEY_ENV_VARS[provider]}`;
        status.consecutiveFailures += 1;
      } else if (isTemporarilyUnavailable) {
        // Keep unavailable status during temporary unavailability
        status.available = false;
      } else {
        // Provider has API key and is not temporarily unavailable
        status.available = true;
        status.consecutiveFailures = 0;
        status.lastError = undefined;
      }
    }
  }
}
