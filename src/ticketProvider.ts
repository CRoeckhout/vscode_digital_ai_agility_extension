import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import axios from 'axios';

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
    private loading = false;

    constructor(private context: vscode.ExtensionContext) { }

    refresh(): void {
        this.tickets = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TicketNode): vscode.TreeItem {
        return element;
    }
    async getChildren(): Promise<any> {
        // Show loading state
        if (this.loading) {
            const loading = new vscode.TreeItem('Loading tickets...', vscode.TreeItemCollapsibleState.None);
            loading.iconPath = new vscode.ThemeIcon('loading~spin');
            return [loading];
        }

        // Return cached tickets if we already loaded them
        if (this.tickets.length > 0) {
            return this.tickets;
        }

        const config = vscode.workspace.getConfiguration('agility');
        const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
        const token = config.get<string>('accessToken');

        if (!baseUrl || !token) {
            const item = new vscode.TreeItem('Click to configure Agility', vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('settings-gear');
            item.command = {
                command: 'agility-helper.configure',
                title: 'Configure'
            };
            this.tickets = [item as any];
            return this.tickets;
        }

        this.loading = true;
        this._onDidChangeTreeData.fire();

        try {
            // Load custom CA if exists
            const certPath = vscode.Uri.joinPath(this.context.globalStorageUri, 'cacerts.pem').fsPath;
            const ca = fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;

            const api = axios.create({
                baseURL: `${baseUrl}/rest-1.v1`,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                httpsAgent: new https.Agent({ ca, rejectUnauthorized: !!ca }),
                timeout: 15000
            });

            const response = await api.get('/Data/PrimaryWorkitem', {
                params: {
                    // Replace Member ID and Status OIDs with your real values!
                    where: `Owners='Member:11976944';Status!='StoryStatus:2999130';Status!='StoryStatus:2999131'`,
                    select: 'Name,Number,Status.Name,Estimate,Scope.Name,AssetType',
                    sort: '-ChangeDate'
                }
            });

            const assets = response.data.Assets || [];
            if (assets.length === 0) {
                const empty = new vscode.TreeItem('No open tickets found', vscode.TreeItemCollapsibleState.None);
                empty.iconPath = new vscode.ThemeIcon('pass');
                this.tickets = [empty as any];
                return this.tickets;
            }

            const items = assets.map((asset: any) => {
                const attrs: any = {};
                for (const attr of Object.values(asset.Attributes) as any[]) {
                    attrs[attr.name] = attr.value;
                }

                const oid = asset.id.split(':')[1];
                const typePrefix = attrs.AssetType === 'Story' ? 'S' : 'D';
                const number = attrs.Number || `${typePrefix}-${oid}`;
                const url = `${baseUrl}/assetDetail.v1?oid=${asset.id}`;

                return new TicketNode(
                    `${number}: ${attrs.Name}`,
                    number,
                    attrs['Status.Name'] || '—',
                    attrs['Scope.Name'] || 'No Project',
                    url
                );
            });

            this.tickets = items;

        } catch (err: any) {
            const msg = err.response?.data?.error || err.message || 'Unknown error';
            const errorItem = new vscode.TreeItem(`Error: ${msg}`, vscode.TreeItemCollapsibleState.None);
            errorItem.iconPath = new vscode.ThemeIcon('error');
            this.tickets = [errorItem as any];
            vscode.window.showErrorMessage(`Agility: ${msg}`);
        } finally {
            this.loading = false;
            this._onDidChangeTreeData.fire();
        }

        return this.tickets;
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