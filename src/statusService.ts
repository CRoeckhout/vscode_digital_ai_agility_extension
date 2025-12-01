import * as vscode from 'vscode';
import { createApi } from './agilityApi';
import { StatusInfo, StatusConfig, StatusConfigMap } from './models/status';
import { colors as defaultColors, unknownColor } from './constants/colors';

/**
 * Gets the currently selected team ID from settings.
 * Returns null if no team is selected.
 */
export function getSelectedTeamId(): string | null {
  const config = vscode.workspace.getConfiguration('agility');
  return config.get<string>('selectedTeam') ?? null;
}

/**
 * Fetches all available StoryStatus values from the Agility API,
 * filtered by the selected team.
 * @param context Extension context
 * @param teamId The team ID to filter statuses by
 */
export async function fetchStatuses(
  context: vscode.ExtensionContext,
  teamId: string
): Promise<StatusInfo[]> {
  const config = vscode.workspace.getConfiguration('agility');
  const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
  const token = config.get<string>('accessToken');

  if (!baseUrl || !token) {
    throw new Error('Agility instance URL or access token not configured');
  }

  const api = await createApi(baseUrl, token, context);

  // Query StoryStatus filtered by Team
  const response = await api.get('/Data/StoryStatus', {
    params: {
      select: 'Name',
      where: `Team='Team:${teamId}'`,
    },
  });

  const assets = (response.data.Assets ?? []) as Array<Record<string, unknown>>;

  return assets.map((asset): StatusInfo => {
    const id = String(asset.id ?? '').split(':')[1] ?? '';
    const attrs: Record<string, unknown> = {};
    const attributes = asset.Attributes as
      | Record<string, { name: string; value: unknown }>
      | undefined;

    if (attributes) {
      for (const v of Object.values(attributes)) {
        attrs[v.name] = v.value;
      }
    }

    return {
      id,
      name: (attrs.Name as string) ?? 'Unknown',
    };
  });
}

/**
 * Gets the current status configuration from VS Code settings.
 * Returns an empty object if not configured.
 */
export function getStatusConfig(): StatusConfigMap {
  const config = vscode.workspace.getConfiguration('agility');
  const statusConfig = config.get<StatusConfigMap>('statusConfig');
  return statusConfig ?? {};
}

/**
 * Saves the status configuration to VS Code settings.
 */
export async function saveStatusConfig(statusConfig: StatusConfigMap): Promise<void> {
  const config = vscode.workspace.getConfiguration('agility');
  await config.update('statusConfig', statusConfig, true);
}

/**
 * Gets the Dev in Progress status ID from config.
 * First checks for statusConfig entry with isDevInProgress flag,
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
  const config = vscode.workspace.getConfiguration('agility');
  return config.get<string>('devInProgressStatusId');
}

/**
 * Gets the color for a status by name or ID.
 * Falls back to default color cycling if not configured.
 */
export function getStatusColor(
  statusName: string,
  statusIndex: number,
  allStatuses: readonly string[]
): string {
  const statusConfig = getStatusConfig();

  // Try to find by name match in config
  for (const cfg of Object.values(statusConfig)) {
    if (cfg.name === statusName) {
      return cfg.color;
    }
  }

  // Unknown status
  if (statusName === 'Unknown' || statusName === '—') {
    return unknownColor;
  }

  // Fall back to default color cycling
  return defaultColors[statusIndex % defaultColors.length] ?? unknownColor;
}

/**
 * Generates initial status configuration from fetched statuses.
 * Uses default colors and marks nothing as Dev in Progress initially.
 */
export function generateInitialStatusConfig(
  statuses: readonly StatusInfo[]
): StatusConfigMap {
  const result: StatusConfigMap = {};

  statuses.forEach((status, index) => {
    result[status.id] = {
      id: status.id,
      name: status.name,
      color: defaultColors[index % defaultColors.length] ?? unknownColor,
      isDevInProgress: false,
    };
  });

  return result;
}

/**
 * Merges fetched statuses with existing configuration.
 * Preserves colors and flags for known statuses, adds new ones with defaults.
 */
export function mergeStatusConfig(
  existingConfig: StatusConfigMap,
  fetchedStatuses: readonly StatusInfo[]
): StatusConfigMap {
  const result: StatusConfigMap = { ...existingConfig };
  let newStatusIndex = Object.keys(existingConfig).length;

  for (const status of fetchedStatuses) {
    if (!result[status.id]) {
      result[status.id] = {
        id: status.id,
        name: status.name,
        color: defaultColors[newStatusIndex % defaultColors.length] ?? unknownColor,
        isDevInProgress: false,
      };
      newStatusIndex++;
    } else {
      // Update name in case it changed, keep color and flags
      result[status.id] = {
        ...result[status.id],
        name: status.name,
      };
    }
  }

  return result;
}
