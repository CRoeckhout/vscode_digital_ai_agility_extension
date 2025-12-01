/**
 * Service for member (user) operations.
 * Handles fetching and managing team members.
 */

import * as vscode from 'vscode';
import { createApiClient, parseAttributes, extractAssetId, handleApiError } from './agilityClient';
import { getValidatedConfig } from '../config';
import { MemberInfo } from '../models';

/**
 * Fetches all members from Agility.
 * 
 * @param context The extension context
 * @returns Array of member info, sorted by name
 */
export async function fetchMembers(
  context: vscode.ExtensionContext
): Promise<MemberInfo[]> {
  const { instanceUrl, accessToken } = getValidatedConfig();
  const api = await createApiClient(instanceUrl, accessToken, context);

  try {
    const response = await api.get('/Data/Member', {
      params: {
        select: 'Name,Username',
      },
    });

    const assets = (response.data.Assets ?? []) as Array<Record<string, unknown>>;

    return assets
      .map((asset): MemberInfo => {
        const attrs = parseAttributes(
          asset as { id: string; Attributes?: Record<string, { name: string; value: unknown }> }
        );
        return {
          id: extractAssetId(String(asset.id ?? '')),
          name: (attrs.Name as string) ?? (attrs.Username as string) ?? '',
          username: (attrs.Username as string) ?? '—',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    throw handleApiError(error, 'Failed to fetch members');
  }
}
