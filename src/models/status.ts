/**
 * Represents a Story/Defect status from Agility
 */
export interface StatusInfo {
  readonly id: string;
  readonly name: string;
}

/**
 * Configuration for a single status including color and special flags
 */
export interface StatusConfig {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly isDevInProgress?: boolean;
}

/**
 * Map of status ID to status configuration
 */
export type StatusConfigMap = Record<string, StatusConfig>;
