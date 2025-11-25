import * as vscode from 'vscode';
import * as fs from 'fs';
import { Member } from './models/member';
import { TicketNode, StatusNode } from './ticketNodes';
import { createApi, parseAttributes } from './agilityApi';

export class AgilityTicketProvider implements vscode.TreeDataProvider<any> {
    private _onDidChangeTreeData = new vscode.EventEmitter<any | undefined | void>();
    onDidChangeTreeData = this._onDidChangeTreeData.event;

    private tickets: TicketNode[] = [];
    private members: Member[] = [];
    private selectedMemberId: string | null = null;
    private loading = false;

    constructor(private context: vscode.ExtensionContext) {
        // Load saved selected member from configuration (if any)
        const config = vscode.workspace.getConfiguration('agility');
        this.selectedMemberId = config.get<string>('selectedMember') || null;

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agility')) {
                this.resetAndRefresh();
            }
        });
    }

    refresh(): void {
        this.tickets = [];
        this._onDidChangeTreeData.fire(undefined);
    }
    private resetAndRefresh() {
        this.tickets = [];
        this.members = [];
        this.selectedMemberId = null;
        this.refresh();
    }

    getTreeItem(element: any): vscode.TreeItem {
        return element;
    }

    // Accept an optional element to allow tree expansion for status nodes
    async getChildren(element?: any): Promise<any[]> {
        // If asking for children of a status node, return its tickets
        if (element instanceof StatusNode) {
            return element.tickets;
        }

        // Top-level behavior
        if (this.loading) {
            const item = new vscode.TreeItem('Loading...', vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('loading~spin');
            return [item];
        }

        const config = vscode.workspace.getConfiguration('agility');
        const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
        const token = config.get<string>('accessToken');

        if (!baseUrl || !token) {
            const item = new vscode.TreeItem('Click to configure Agility', vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('settings-gear');
            item.command = { command: 'agility-helper.configure', title: 'Configure' };
            return [item];
        }

        // If a member was previously selected (persisted in config) but we haven't loaded members yet,
        // load the team members so we can show a friendly name in the header.
        if (this.selectedMemberId && this.members.length === 0) {
            await this.loadTeamMembers(baseUrl, token);
        }

        // === 1. Show Member Selector (if not already selected) ===
        if (!this.selectedMemberId) {
            if (this.members.length === 0) {
                await this.loadTeamMembers(baseUrl, token);
            }

            if (this.members.length === 0) {
                const item = new vscode.TreeItem('No team room configured or no members found', vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon('warning');
                return [item];
            }

            const selected = await vscode.window.showQuickPick(
                this.members.map(m => ({ label: m.name, description: m.username, memberId: m.id })),
                { placeHolder: 'Select a team member to view their tickets' }
            );

            if (!selected) {
                return [new vscode.TreeItem('Select a member to continue', vscode.TreeItemCollapsibleState.None)];
            }

            this.selectedMemberId = selected.memberId;
            // Persist the selection so it remains across reloads
            await config.update('selectedMember', selected.memberId, true);
            this.refresh(); // trigger reload with selected member
            return [new vscode.TreeItem(`Loading tickets for ${selected.label}...`, vscode.TreeItemCollapsibleState.None)];
        }

        // === 2. Load tickets for selected member ===
        if (this.tickets.length === 0) {
            this.loading = true;
            this._onDidChangeTreeData.fire(undefined);

            try {
                const api = await createApi(baseUrl, token, this.context);
                const response = await api.get('/Data/PrimaryWorkitem', {
                    params: {
                        where: `Owners='Member:${this.selectedMemberId}';Status!='StoryStatus:2999130';Status!='StoryStatus:2999131'`,
                        select: 'Name,Number,Status.Name,Estimate,Scope.Name,AssetType',
                        sort: '-ChangeDate'
                    }
                });

                const assets = response.data.Assets || [];
                if (assets.length === 0) {
                    const selectedName = this.members.find(m => m.id === this.selectedMemberId)?.name || 'Selected member';
                    this.tickets = [new vscode.TreeItem(`${selectedName} has no open tickets`, vscode.TreeItemCollapsibleState.None) as any];
                    return this.tickets;
                }

                this.tickets = assets.map((asset: any) => {
                    const attrs: any = {};
                    for (const a of Object.values(asset.Attributes) as any[]) {attrs[a.name] = a.value;}

                    const number = attrs.Number || asset.id.split(':').pop();
                    const url = `${baseUrl}/assetDetail.v1?oid=${asset.id}`;

                    return new TicketNode(
                        `${number}: ${attrs.Name}`,
                        number,
                        attrs['Status.Name'] || '—',
                        attrs['Scope.Name'] || 'No Project',
                        url
                    );
                });

            } catch (err: any) {
                const msg = err.response?.data?.error || err.message;
                this.tickets = [new vscode.TreeItem(`Error: ${msg}`, vscode.TreeItemCollapsibleState.None) as any];
                vscode.window.showErrorMessage(`Agility: ${msg}`);
            } finally {
                this.loading = false;
                this._onDidChangeTreeData.fire(undefined);
            }
        }

        // === 3. Add "Change Member" button at the top ===
        const currentMember = this.members.find(m => m.id === this.selectedMemberId);
        const header = new vscode.TreeItem(
            `${currentMember?.name || 'Unknown'} • Click to change`,
            vscode.TreeItemCollapsibleState.None
        );
        header.command = {
            command: 'agility.changeMember',
            title: 'Change Member'
        };
        header.iconPath = new vscode.ThemeIcon('account');

        // If tickets are not TicketNode instances (error/no tickets message), return them as-is
        if (this.tickets.length === 0 || !(this.tickets[0] instanceof TicketNode)) {
            return [header, ...this.tickets];
        }

        // === 4. Group tickets by status and assign colors ===
        const statusMap = new Map<string, TicketNode[]>();
        for (const t of this.tickets as TicketNode[]) {
            const key = t.status || 'Unknown';
            if (!statusMap.has(key)) {statusMap.set(key, []);}
            statusMap.get(key)!.push(t);
        }

        const colors = [
            '#1f77b4', // blue
            '#ff7f0e', // orange
            '#2ca02c', // green
            '#d62728', // red
            '#9467bd', // purple
            '#8c564b'  // brown
        ];
        const unknownColor = '#999999';

        const statuses = Array.from(statusMap.keys()).sort((a, b) => a.localeCompare(b));
        const statusNodes: StatusNode[] = statuses.map((s, idx) => {
            const color = s === 'Unknown' ? unknownColor : (colors[idx % colors.length] || unknownColor);
            return new StatusNode(s, color, statusMap.get(s)!);
        });

        return [header, ...statusNodes];
    }

    private async loadTeamMembers(baseUrl: string, token: string) {
        try {
            const api = await createApi(baseUrl, token, this.context);
            const res = await api.get(`/Data/Member`, {
                params: { select: 'Name,Username' }
            });

            this.members = (res.data.Assets || []).map((a: any) => {
                const attrs: any = {};
                for (const v of Object.values(a.Attributes) as any[]) { attrs[v.name] = v.value; }
                return {
                    id: a.id.split(':')[1],
                    name: attrs.Name || attrs.Username,
                    username: attrs.Username || '—'
                };
            }).sort((a: any, b: any) => a.name.localeCompare(b.name));

        } catch (err) {
            vscode.window.showWarningMessage('Could not load team members. Check Team Room OID.');
            this.members = [];
        }
    }

    // Called from extension.ts
    async changeMember() {
        // Clear persisted selection and reset in-memory selection
        const config = vscode.workspace.getConfiguration('agility');
        await config.update('selectedMember', undefined, true);
        this.selectedMemberId = null;
        this.tickets = [];
        this.refresh();
    }
    // Optional: upload custom CA cert
    async uploadCustomCert() {
        const uris = await vscode.window.showOpenDialog({
            filters: { 'Certificates': ['pem', 'crt', 'cer'] },
            title: 'Select custom CA certificate (PEM format)'
        });
        if (uris?.[0]) {
            await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
            await vscode.workspace.fs.copy(uris[0], vscode.Uri.joinPath(this.context.globalStorageUri, 'cacerts.pem'), { overwrite: true });
            vscode.window.showInformationMessage('Custom CA saved – refreshing tickets...');
            this.refresh();
        }
    }

}