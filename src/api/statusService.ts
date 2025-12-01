/**
 * Service for status operations.
 * Handles fetching and managing Story/Defect statuses.
 */

import * as vscode from 'vscode';
import { createApiClient, parseAttributes, extractAssetId, handleApiError } from './agilityClient';
import { getValidatedConfig, getStatusConfig, saveStatusConfig } from '../config';
import { StatusInfo, StatusConfig, StatusConfigMap } from '../models';
import { colors as defaultColors, unknownColor, agilityColorToHex } from '../constants/colors';

/**
 * Fetches all StoryStatus values for a specific team.
 * 
 * @param context The extension context
 * @param teamId The team ID to filter by
 * @returns Array of status info, sorted by order
 */
export async function fetchStatuses(
  context: vscode.ExtensionContext,
  teamId: string
): Promise<StatusInfo[]> {
  const { instanceUrl, accessToken } = getValidatedConfig();
  const api = await createApiClient(instanceUrl, accessToken, context);

  try {
    const response = await api.get('/Data/StoryStatus', {
      params: {
        select: 'Name,Order,ColorName',
        where: `Team='Team:${teamId}'`,
        sort: 'Order',
      },
    });

    const assets = (response.data.Assets ?? []) as Array<Record<string, unknown>>;

    return assets.map((asset): StatusInfo => {
      const attrs = parseAttributes(
        asset as { id: string; Attributes?: Record<string, { name: string; value: unknown }> }
      );
      return {
        id: extractAssetId(String(asset.id ?? '')),
        name: (attrs.Name as string) ?? 'Unknown',
        order: Number(attrs.Order) || 0,
        colorName: (attrs.ColorName as string) ?? undefined,
      };
    });
  } catch (error) {
    throw handleApiError(error, 'Failed to fetch statuses');
  }
}

/**
 * Gets the color for a status by name.
 * Falls back to default color cycling if not configured.
 */
export function getStatusColor(
  statusName: string,
  statusIndex: number
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
 * Uses Agility colors if available, otherwise default colors.
 */
export function generateInitialStatusConfig(
  statuses: readonly StatusInfo[]
): StatusConfigMap {
  const result: StatusConfigMap = {};

  statuses.forEach((status, index) => {
    const color = status.colorName
      ? agilityColorToHex(status.colorName)
      : defaultColors[index % defaultColors.length] ?? unknownColor;

    result[status.id] = {
      id: status.id,
      name: status.name,
      color,
      order: status.order,
      isDevInProgress: false,
    };
  });

  return result;
}

/**
 * Merges fetched statuses with existing configuration.
 * Preserves colors and flags for known statuses, adds new ones with Agility colors or defaults.
 */
export function mergeStatusConfig(
  existingConfig: StatusConfigMap,
  fetchedStatuses: readonly StatusInfo[]
): StatusConfigMap {
  const result: StatusConfigMap = { ...existingConfig };
  let newStatusIndex = Object.keys(existingConfig).length;

  for (const status of fetchedStatuses) {
    if (!result[status.id]) {
      const color = status.colorName
        ? agilityColorToHex(status.colorName)
        : defaultColors[newStatusIndex % defaultColors.length] ?? unknownColor;

      result[status.id] = {
        id: status.id,
        name: status.name,
        color,
        order: status.order,
        isDevInProgress: false,
      };
      newStatusIndex++;
    } else {
      // Update name and order in case they changed, keep color and flags
      result[status.id] = {
        ...result[status.id],
        name: status.name,
        order: status.order,
      };
    }
  }

  return result;
}

/**
 * Updates the Dev in Progress flag for a status.
 * If setting to true, clears the flag from all other statuses.
 */
export async function setStatusDevInProgress(
  statusId: string,
  isDevInProgress: boolean
): Promise<void> {
  const config = getStatusConfig();
  const updatedConfig: StatusConfigMap = {};

  for (const [id, cfg] of Object.entries(config)) {
    updatedConfig[id] = {
      ...cfg,
      isDevInProgress: id === statusId ? isDevInProgress : (isDevInProgress ? false : cfg.isDevInProgress),
    };
  }

  await saveStatusConfig(updatedConfig);
}

/**
 * Updates a status color.
 */
export async function setStatusColor(
  statusId: string,
  color: string
): Promise<void> {
  const config = getStatusConfig();
  
  if (config[statusId]) {
    const updatedConfig: StatusConfigMap = {
      ...config,
      [statusId]: {
        ...config[statusId],
        color,
      },
    };
    await saveStatusConfig(updatedConfig);
  }
}

/**
 * Toggles a status visibility.
 */
export async function toggleStatusVisibility(statusId: string): Promise<void> {
  const config = getStatusConfig();
  
  if (config[statusId]) {
    const isCurrentlyHidden = config[statusId].hidden ?? false;
    const updatedConfig: StatusConfigMap = {
      ...config,
      [statusId]: {
        ...config[statusId],
        hidden: !isCurrentlyHidden,
      },
    };
    await saveStatusConfig(updatedConfig);
  }
}
