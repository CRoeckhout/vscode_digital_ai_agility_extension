/**
 * Service for ticket (workitem) operations.
 * Handles fetching, updating, and managing Story/Defect tickets.
 */

import * as vscode from 'vscode';
import { createApiClient, parseAttributes, extractAssetId, handleApiError } from './agilityClient';
import { getValidatedConfig } from '../config';
import { ApiError } from '../errors';
import { TicketData } from '../models/ticket';

/**
 * Fetches tickets owned by a specific member.
 * 
 * @param context The extension context
 * @param memberId The member ID to filter by
 * @returns Array of ticket data
 */
export async function fetchTicketsByMember(
  context: vscode.ExtensionContext,
  memberId: string
): Promise<TicketData[]> {
  const { instanceUrl, accessToken } = getValidatedConfig();
  const api = await createApiClient(instanceUrl, accessToken, context);

  try {
    const response = await api.get('/Data/PrimaryWorkitem', {
      params: {
        where: `Owners='Member:${memberId}'`,
        select: 'Name,Number,Status.Name,Estimate,Scope.Name,AssetType',
        sort: '-ChangeDate',
      },
    });

    return mapAssetsToTickets(response.data.Assets ?? [], instanceUrl);
  } catch (error) {
    throw handleApiError(error, 'Failed to fetch tickets by member');
  }
}

/**
 * Fetches tickets for a specific team.
 * 
 * @param context The extension context
 * @param teamId The team ID to filter by
 * @returns Array of ticket data
 */
export async function fetchTicketsByTeam(
  context: vscode.ExtensionContext,
  teamId: string
): Promise<TicketData[]> {
  const { instanceUrl, accessToken } = getValidatedConfig();
  const api = await createApiClient(instanceUrl, accessToken, context);

  try {
    const response = await api.get('/Data/PrimaryWorkitem', {
      params: {
        where: `Team='Team:${teamId}'`,
        select: 'Name,Number,Status.Name,Estimate,Scope.Name,AssetType',
        sort: '-ChangeDate',
      },
    });

    return mapAssetsToTickets(response.data.Assets ?? [], instanceUrl);
  } catch (error) {
    throw handleApiError(error, 'Failed to fetch tickets by team');
  }
}

/**
 * Fetches detailed information for a single ticket.
 * 
 * @param context The extension context
 * @param assetId The ticket's asset ID
 * @returns Ticket attributes
 */
export async function fetchTicketDetail(
  context: vscode.ExtensionContext,
  assetId: string
): Promise<Record<string, unknown>> {
  const { instanceUrl, accessToken } = getValidatedConfig();
  const api = await createApiClient(instanceUrl, accessToken, context);

  try {
    const response = await api.get(`/Data/PrimaryWorkitem/${assetId}`, {
      params: {
        select: 'Name,Number,Description,Status.Name,Owners.Name,Estimate,ToDo,Scope.Name,ChangeDate,AssetType',
      },
    });

    return parseAttributes(response.data);
  } catch (error) {
    throw handleApiError(error, 'Failed to fetch ticket details');
  }
}

/**
 * Updates a ticket's status and optionally adds an owner.
 * 
 * @param context The extension context
 * @param ticketId The ticket's numeric ID
 * @param statusId The new status ID
 * @param assetType The asset type (Story or Defect)
 * @param ownerId Optional member ID to add as owner
 */
export async function updateTicketStatus(
  context: vscode.ExtensionContext,
  ticketId: string,
  statusId: string,
  assetType: string,
  ownerId?: string | null
): Promise<void> {
  const { instanceUrl, accessToken } = getValidatedConfig();
  const api = await createApiClient(instanceUrl, accessToken, context);

  const endpoint = assetType === 'Defect' ? 'Defect' : 'Story';

  // Build XML payload
  let xml = `<Asset>
  <Relation name="Status" act="set">
    <Asset idref="StoryStatus:${statusId}" />
  </Relation>`;

  if (ownerId) {
    xml += `
  <Relation name="Owners">
    <Asset idref="Member:${ownerId}" act="add" />
  </Relation>`;
  }

  xml += '\n</Asset>';

  try {
    await api.post(`/Data/${endpoint}/${ticketId}`, xml, {
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    });
  } catch (error) {
    // Try attribute-style payload as fallback
    const apiError = error as { response?: { status?: number } };
    if (apiError.response?.status === 400) {
      try {
        const altXml = `<Asset>\n  <Attribute name="Status" act="set">StoryStatus:${statusId}</Attribute>\n</Asset>`;
        await api.post(`/Data/${endpoint}/${ticketId}`, altXml, {
          headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        });
        return;
      } catch (fallbackError) {
        throw handleApiError(fallbackError, 'Failed to update ticket status (fallback)');
      }
    }
    throw handleApiError(error, 'Failed to update ticket status');
  }
}

/**
 * Fetches an image from the API and returns it as a data URI.
 * Used for embedding images in ticket descriptions.
 * 
 * @param context The extension context
 * @param imageUrl The image URL to fetch
 * @returns Data URI string or null if failed
 */
export async function fetchImageAsDataUri(
  context: vscode.ExtensionContext,
  imageUrl: string
): Promise<string | null> {
  const { instanceUrl, accessToken } = getValidatedConfig();
  const api = await createApiClient(instanceUrl, accessToken, context);

  try {
    // Resolve relative URLs
    let absoluteUrl = imageUrl;
    try {
      absoluteUrl = new URL(imageUrl, instanceUrl).toString();
    } catch {
      absoluteUrl = imageUrl;
    }

    const response = await api.get(absoluteUrl, { responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const b64 = Buffer.from(response.data, 'binary').toString('base64');
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Maps raw API assets to TicketData objects.
 */
function mapAssetsToTickets(
  assets: Array<Record<string, unknown>>,
  baseUrl: string
): TicketData[] {
  return assets.map((asset) => {
    const attrs = parseAttributes(asset as { id: string; Attributes?: Record<string, { name: string; value: unknown }> });
    const id = String(asset.id ?? '');
    const number = (attrs.Number as string) ?? extractAssetId(id);
    const assetId = extractAssetId(id);
    const url = `${baseUrl}/assetDetail.v1?oid=${id}`;

    return {
      label: `${number}: ${attrs.Name ?? ''}`,
      number,
      assetId,
      status: (attrs['Status.Name'] as string) ?? '—',
      project: (attrs['Scope.Name'] as string) ?? 'No Project',
      url,
      assetType: (attrs.AssetType as string) ?? 'Story',
    };
  });
}
