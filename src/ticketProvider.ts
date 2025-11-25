import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import axios from 'axios';
import { Member } from './models/member';

export class TicketNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly number: string,
        public readonly status: string,
        public readonly project: string,
        public readonly url: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${number} • ${status} • ${project}`;
        this.description = `${status} • ${project}`;
        this.contextValue = 'ticket';
        this.iconPath = new vscode.ThemeIcon('ticket');

        this.command = {
            command: 'agility.openInBrowser',
            title: 'Open in Agility',
            arguments: [url]
        };
    }
}

export class AgilityTicketProvider implements vscode.TreeDataProvider<TicketNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TicketNode | undefined | void>();
    onDidChangeTreeData = this._onDidChangeTreeData.event;

    private tickets: TicketNode[] = [];
    private members: Member[] = [];
    private selectedMemberId: string | null = null;
    private loading = false;

    constructor(private context: vscode.ExtensionContext) {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agility')) {
                this.resetAndRefresh();
            }
        });
    }

    refresh(): void {
        this.tickets = [];
        this._onDidChangeTreeData.fire();
    }

    private resetAndRefresh() {
        this.tickets = [];
        this.members = [];
        this.selectedMemberId = null;
        this.refresh();
    }

    getTreeItem(element: TicketNode): vscode.TreeItem {
        return element;
    }
    async getChildren(): Promise<any> {
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
            this.refresh(); // trigger reload with selected member
            return [new vscode.TreeItem(`Loading tickets for ${selected.label}...`, vscode.TreeItemCollapsibleState.None)];
        }

        // === 2. Load tickets for selected member ===
        if (this.tickets.length === 0) {
            this.loading = true;
            this._onDidChangeTreeData.fire();

            try {
                const certPath = vscode.Uri.joinPath(this.context.globalStorageUri, 'cacerts.pem').fsPath;
                const ca = fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;

                const api = axios.create({
                    baseURL: `${baseUrl}/rest-1.v1`,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    httpsAgent: new https.Agent({ ca, rejectUnauthorized: !!ca }),
                    timeout: 15000
                });

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
                this._onDidChangeTreeData.fire();
            }
        }

        // === 3. Add "Change Member" button at the top ===
        const currentMember = this.members.find(m => m.id === this.selectedMemberId);
        const header = new vscode.TreeItem(
            `$(person) ${currentMember?.name || 'Unknown'} • Click to change`,
            vscode.TreeItemCollapsibleState.None
        );
        header.command = {
            command: 'agility.changeMember',
            title: 'Change Member'
        };
        header.iconPath = new vscode.ThemeIcon('account');

        return [header, ...this.tickets];
    }

    private async loadTeamMembers(baseUrl: string, token: string) {
        try {
            const certPath = vscode.Uri.joinPath(this.context.globalStorageUri, 'cacerts.pem').fsPath;
            const ca = fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;

            const api = axios.create({
                baseURL: `${baseUrl}/rest-1.v1`,
                headers: { Authorization: `Bearer ${token}` },
                httpsAgent: new https.Agent({ ca, rejectUnauthorized: !!ca })
            });

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
    changeMember() {
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