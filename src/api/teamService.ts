/**
 * Service for team operations.
 * Handles fetching and managing teams.
 */

import * as vscode from 'vscode';
import { createApiClient, parseAttributes, extractAssetId, handleApiError } from './agilityClient';
import { getValidatedConfig } from '../config';
import { TeamInfo } from '../models';

/**
 * Fetches all teams from Agility.
 * 
 * @param context The extension context
 * @returns Array of team info, sorted by name
 */
export async function fetchTeams(
  context: vscode.ExtensionContext
): Promise<TeamInfo[]> {
  const { instanceUrl, accessToken } = getValidatedConfig();
  const api = await createApiClient(instanceUrl, accessToken, context);

  try {
    const response = await api.get('/Data/Team', {
      params: {
        select: 'Name',
      },
    });

    const assets = (response.data.Assets ?? []) as Array<Record<string, unknown>>;

    return assets
      .map((asset): TeamInfo => {
        const attrs = parseAttributes(
          asset as { id: string; Attributes?: Record<string, { name: string; value: unknown }> }
        );
        return {
          id: extractAssetId(String(asset.id ?? '')),
          name: (attrs.Name as string) ?? 'Unnamed Team',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    throw handleApiError(error, 'Failed to fetch teams');
  }
}
