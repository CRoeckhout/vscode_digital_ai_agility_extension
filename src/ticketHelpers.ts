import * as vscode from 'vscode';
import { TicketNode, StatusNode } from './ticketNodes';
import { Member } from './models/member';
import { colors, unknownColor } from './constants/colors';

// Minimal helpers that encapsulate UI items and ticket mapping/grouping logic
export function createLoadingItem(): vscode.TreeItem {
    const item = new vscode.TreeItem('Loading...', vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('loading~spin');
    return item;
}

export function createConfigPromptItem(): vscode.TreeItem {
    const item = new vscode.TreeItem('Click to configure Agility', vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('settings-gear');
    item.command = { command: 'agility-helper.configure', title: 'Configure' };
    return item;
}

export function createNoMembersItem(): vscode.TreeItem {
    const item = new vscode.TreeItem('No team room configured or no members found', vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('warning');
    return item;
}

export function mapAssetsToTicketNodes(assets: any[], baseUrl: string): TicketNode[] {
    return assets.map((asset: any) => {
        const attrs: Record<string, any> = {};
        for (const a of Object.values(asset.Attributes) as any[]) {
            attrs[a.name] = a.value;
        }

        const number = attrs.Number || String(asset.id).split(':').pop();
        const url = `${baseUrl}/assetDetail.v1?oid=${asset.id}`;

        return new TicketNode(
            `${number}: ${attrs.Name}`,
            number,
            attrs['Status.Name'] || '—',
            attrs['Scope.Name'] || 'No Project',
            url
        );
    });
}

export function groupTicketsByStatus(tickets: TicketNode[]): Map<string, TicketNode[]> {
    const statusMap = new Map<string, TicketNode[]>();
    for (const t of tickets) {
        const key = t.status || 'Unknown';
        if (!statusMap.has(key)) { statusMap.set(key, []); }
        statusMap.get(key)!.push(t);
    }
    return statusMap;
}

export function buildHeader(currentMember?: Member) : vscode.TreeItem {
    const header = new vscode.TreeItem(
        `${currentMember?.name || 'Unknown'} • Click to change`,
        vscode.TreeItemCollapsibleState.None
    );
    header.command = { command: 'agility.changeMember', title: 'Change Member' };
    header.iconPath = new vscode.ThemeIcon('account');
    return header;
}

export function createStatusNodes(statusMap: Map<string, TicketNode[]>): StatusNode[] {
    const statuses = Array.from(statusMap.keys()).sort((a, b) => a.localeCompare(b));
    return statuses.map((s, idx) => {
        const color = s === 'Unknown' ? unknownColor : (colors[idx % colors.length] || unknownColor);
        return new StatusNode(s, color, statusMap.get(s)!);
    });
}
