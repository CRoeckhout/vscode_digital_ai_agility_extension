import * as vscode from 'vscode';
import { Member } from './models/member';
import { TicketNode, StatusNode } from './ticketNodes';
import { createApi } from './agilityApi';
import {
    createLoadingItem,
    createConfigPromptItem,
    createNoMembersItem,
    mapAssetsToTicketNodes,
    groupTicketsByStatus,
    buildHeader,
    createStatusNodes
} from './ticketHelpers';
import { ignoredStatuses } from './constants/ignored-status';

export class AgilityTicketProvider implements vscode.TreeDataProvider<any> {
    private _onDidChangeTreeData = new vscode.EventEmitter<any | undefined | void>();
    onDidChangeTreeData = this._onDidChangeTreeData.event;

    private tickets: TicketNode[] = [];
    private members: Member[] = [];
    private selectedMemberId: string | null = null;
    // Prevent re-entrant quick pick prompts when VS Code requests children repeatedly
    private selectingMember = false;
    private loading = false;

    constructor(private context: vscode.ExtensionContext) {
        // Load saved selected member from configuration (if any)
        const config = vscode.workspace.getConfiguration('agility');
        this.selectedMemberId = config.get<string>('selectedMember') || null;

        // Only reset when core connectivity configuration changes. Avoid reacting to
        // changes of transient values like 'selectedMember' which would cause the
        // selection to be cleared immediately after it's saved.
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agility.instanceUrl') || e.affectsConfiguration('agility.accessToken')) {
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
            return [createLoadingItem()];
        }

        const config = vscode.workspace.getConfiguration('agility');
        const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
        const token = config.get<string>('accessToken');

        if (!baseUrl || !token) {
            return [createConfigPromptItem()];
        }

        // If a member was previously selected (persisted in config) but we haven't loaded members yet,
        // load the team members so we can show a friendly name in the header.
        if (this.selectedMemberId && this.members.length === 0) {
            await this.loadTeamMembers(baseUrl, token);
        }

        // === 1. Show Member Selector (if not already selected) ===
        if (!this.selectedMemberId) {
            // If members are not loaded yet, load them
            if (this.members.length === 0) {
                await this.loadTeamMembers(baseUrl, token);
            }

            if (this.members.length === 0) {
                return [createNoMembersItem()];
            }

            // Prevent multiple simultaneous prompts caused by VS Code calling getChildren repeatedly
            if (this.selectingMember) {
                return [new vscode.TreeItem('Select a member to continue', vscode.TreeItemCollapsibleState.None)];
            }

            this.selectingMember = true;
            try {
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
            } finally {
                this.selectingMember = false;
            }
        }

        // === 2. Load tickets for selected member ===
        if (this.tickets.length === 0) {
            this.loading = true;
            this._onDidChangeTreeData.fire(undefined);

            try {
                const api = await createApi(baseUrl, token, this.context);
                const _ignoredStatuses: string = ignoredStatuses.reduce((acc, status, i) => acc += `Status!='StoryStatus:${status}'${i + 1 !== ignoredStatuses.length ? ';' : ''}`, '');
                const where = `Owners='Member:${this.selectedMemberId}'${_ignoredStatuses.length ? `;${_ignoredStatuses}` : ''}`;
                const response = await api.get('/Data/PrimaryWorkitem', {
                    params: {
                        where: where,
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

                this.tickets = mapAssetsToTicketNodes(assets, baseUrl);

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
        const header = buildHeader(currentMember);

        // If tickets are not TicketNode instances (error/no tickets message), return them as-is
        if (this.tickets.length === 0 || !(this.tickets[0] instanceof TicketNode)) {
            return [header, ...this.tickets];
        }

        // === 4. Group tickets by status and create status nodes using helpers ===
        const statusMap = groupTicketsByStatus(this.tickets as TicketNode[]);
        const statusNodes = createStatusNodes(statusMap);

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