/**
 * Ticket (workitem) data models.
 */

/**
 * Represents a single ticket (Story or Defect) from Agility.
 */
export interface TicketData {
  readonly label: string;
  readonly number: string;
  readonly assetId: string;
  readonly status: string;
  readonly project: string;
  readonly url: string;
  readonly assetType: 'Story' | 'Defect' | string;
}

/**
 * Represents a group of tickets under a common status.
 */
export interface StatusGroup {
  readonly status: string;
  readonly color: string;
  readonly tickets: readonly TicketData[];
}
