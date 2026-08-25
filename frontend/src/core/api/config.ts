/** Server configuration API module. */
import type { VerificationMode } from '../projection/projectionStore';
import { request } from './http';

export interface ServerConfig {
  /** Whether this deployment can grade photos with a model at all. */
  ai_referee: boolean;
  /** The grading modes on offer, in the order a launcher should present them. */
  verification_modes: VerificationMode[];
  /** Whether anonymous usage recording is enabled on the server. */
  analytics?: boolean;
}

/**
 * Fetches server capability configuration.
 * Returns supported verification modes and feature flags.
 */
export function getServerConfig(): Promise<ServerConfig> {
  return request('/api/config');
}
