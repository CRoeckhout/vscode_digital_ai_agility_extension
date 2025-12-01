/**
 * Centralized configuration service for the Agility extension.
 * Provides type-safe access to VS Code settings.
 */

import * as vscode from 'vscode';
import { ConfigurationError } from '../errors';
import { StatusConfigMap } from '../models/status';

/**
 * Configuration keys used by the extension.
 */
const CONFIG_SECTION = 'agility';

/**
 * Interface for the Agility configuration.
 */
export interface AgilityConfig {
  readonly instanceUrl: string | null;
  readonly accessToken: string | null;
  readonly selectedMember: string | null;
  readonly selectedTeam: string | null;
  readonly statusConfig: StatusConfigMap;
  readonly devInProgressStatusId: string | null;
}

/**
 * Gets the VS Code configuration for the Agility extension.
 */
function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/**
 * Gets the configured instance URL, with trailing slashes removed.
 */
export function getInstanceUrl(): string | null {
  const config = getConfig();
  const url = config.get<string>('instanceUrl');
  return url?.replace(/\/+$/, '') ?? null;
}

/**
 * Gets the configured access token.
 */
export function getAccessToken(): string | null {
  const config = getConfig();
  return config.get<string>('accessToken') ?? null;
}

/**
 * Gets the selected member ID for the "My Tickets" view.
 */
export function getSelectedMemberId(): string | null {
  const config = getConfig();
  return config.get<string>('selectedMember') ?? null;
}

/**
 * Sets the selected member ID.
 */
export async function setSelectedMemberId(memberId: string | null): Promise<void> {
  const config = getConfig();
  await config.update('selectedMember', memberId ?? undefined, true);
}

/**
 * Gets the selected team ID for the "Team Tickets" view.
 */
export function getSelectedTeamId(): string | null {
  const config = getConfig();
  return config.get<string>('selectedTeam') ?? null;
}

/**
 * Sets the selected team ID.
 */
export async function setSelectedTeamId(teamId: string | null): Promise<void> {
  const config = getConfig();
  await config.update('selectedTeam', teamId ?? undefined, true);
}

/**
 * Gets the status configuration map.
 */
export function getStatusConfig(): StatusConfigMap {
  const config = getConfig();
  return config.get<StatusConfigMap>('statusConfig') ?? {};
}

/**
 * Saves the status configuration map.
 */
export async function saveStatusConfig(statusConfig: StatusConfigMap): Promise<void> {
  const config = getConfig();
  await config.update('statusConfig', statusConfig, true);
}

/**
 * Gets the Dev in Progress status ID.
 * First checks statusConfig for a status with isDevInProgress flag,
 * then falls back to the legacy devInProgressStatusId setting.
 */
export function getDevInProgressStatusId(): string | undefined {
  const statusConfig = getStatusConfig();

  // Check for status marked as Dev in Progress
  for (const [id, cfg] of Object.entries(statusConfig)) {
    if (cfg.isDevInProgress) {
      return id;
    }
  }

  // Fall back to legacy setting
  const config = getConfig();
  return config.get<string>('devInProgressStatusId') ?? undefined;
}

/**
 * Gets the full configuration, validating that required fields are present.
 * @throws ConfigurationError if instance URL or token is missing
 */
export function getValidatedConfig(): { instanceUrl: string; accessToken: string } {
  const instanceUrl = getInstanceUrl();
  const accessToken = getAccessToken();

  if (!instanceUrl) {
    throw new ConfigurationError('Agility instance URL not configured');
  }

  if (!accessToken) {
    throw new ConfigurationError('Agility access token not configured');
  }

  return { instanceUrl, accessToken };
}

/**
 * Checks if the extension is properly configured.
 */
export function isConfigured(): boolean {
  const instanceUrl = getInstanceUrl();
  const accessToken = getAccessToken();
  return Boolean(instanceUrl && accessToken);
}

/**
 * Updates the instance URL.
 */
export async function setInstanceUrl(url: string): Promise<void> {
  const config = getConfig();
  await config.update('instanceUrl', url.trim(), true);
}

/**
 * Updates the access token.
 */
export async function setAccessToken(token: string): Promise<void> {
  const config = getConfig();
  await config.update('accessToken', token.trim(), true);
}
