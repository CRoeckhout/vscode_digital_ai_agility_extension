/**
 * Agility API client factory.
 * Creates configured Axios instances for making API requests.
 */

import * as https from 'https';
import * as fs from 'fs';
import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { ApiError } from '../errors';

/**
 * Creates an Axios instance configured for the Agility REST API.
 * 
 * @param baseUrl The Agility instance base URL
 * @param token The personal access token
 * @param context The extension context (for accessing global storage)
 * @returns A configured Axios instance
 */
export async function createApiClient(
  baseUrl: string,
  token: string,
  context: vscode.ExtensionContext
): Promise<AxiosInstance> {
  const certPath = vscode.Uri.joinPath(context.globalStorageUri, 'cacerts.pem').fsPath;
  const ca = fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;

  return axios.create({
    baseURL: `${baseUrl}/rest-1.v1`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    httpsAgent: new https.Agent({
      ca,
      rejectUnauthorized: Boolean(ca),
    }),
    timeout: 15000,
  });
}

/**
 * Raw asset structure from the Agility API.
 */
export interface RawAsset {
  readonly id: string;
  readonly Attributes?: Record<string, { name: string; value: unknown }>;
}

/**
 * Parses attributes from a raw asset into a flat key-value map.
 */
export function parseAttributes(asset: RawAsset): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (asset.Attributes) {
    for (const v of Object.values(asset.Attributes)) {
      attrs[v.name] = v.value;
    }
  }
  return attrs;
}

/**
 * Extracts the numeric ID from an asset OID (e.g., "Story:12345" -> "12345").
 */
export function extractAssetId(oid: string): string {
  return oid.split(':')[1] ?? oid;
}

/**
 * Wraps an Axios error into an ApiError.
 */
export function handleApiError(error: unknown, defaultMessage: string): ApiError {
  const axiosError = error as {
    response?: { data?: unknown; status?: number };
    message?: string;
  };

  const statusCode = axiosError.response?.status;
  const responseBody = axiosError.response?.data;
  const message = axiosError.message ?? defaultMessage;

  return new ApiError(message, statusCode, responseBody, error);
}
