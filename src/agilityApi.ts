import * as https from 'https';
import * as fs from 'fs';
import axios from 'axios';
import * as vscode from 'vscode';

export interface RawAsset { id: string; Attributes?: any; }

export async function createApi(baseUrl: string, token: string, context: vscode.ExtensionContext) {
    const certPath = vscode.Uri.joinPath(context.globalStorageUri, 'cacerts.pem').fsPath;
    const ca = fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;

    return axios.create({
        baseURL: `${baseUrl}/rest-1.v1`,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        httpsAgent: new https.Agent({ ca, rejectUnauthorized: !!ca }),
        timeout: 15000
    });
}

export function parseAttributes(asset: RawAsset) {
    const attrs: any = {};
    for (const v of Object.values(asset.Attributes || {}) as any[]) { attrs[v.name] = v.value; }
    return attrs;
}
