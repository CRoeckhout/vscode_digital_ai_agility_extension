import * as vscode from 'vscode';
import { TicketNode, StatusNode } from './nodes';
import { createApi } from '../agilityApi';
import {
    createLoadingItem,
    createConfigPromptItem,
    mapAssetsToTicketNodes,
    groupTicketsByStatus,
    buildTeamHeader,
    createStatusNodes
} from './helpers';
import { ignoredStatuses } from '../constants/ignored-status';

export class TeamTicketProvider implements vscode.TreeDataProvider<any> {
    private _onDidChangeTreeData = new vscode.EventEmitter<any | undefined | void>();
    onDidChangeTreeData = this._onDidChangeTreeData.event;

    private tickets: TicketNode[] = [];
    private selectedTeamCsv: string | null = null; // comma separated member ids or a single team id or member ids
    private currentFilter: string | null = null;
    private loading = false;

    constructor(private context: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('agility');
        this.selectedTeamCsv = config.get<string>('selectedTeam') || null;

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agility.instanceUrl') || e.affectsConfiguration('agility.accessToken')) {
                this.tickets = [];
                this.selectedTeamCsv = null;
                this._onDidChangeTreeData.fire(undefined);
            }
        });
    }

    refresh(): void {
        this.tickets = [];
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: any): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: any): Promise<any[]> {
        if (element instanceof StatusNode) {
            return element.tickets;
        }

        if (this.loading) {
            return [createLoadingItem()];
        }

        const config = vscode.workspace.getConfiguration('agility');
        const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
        const token = config.get<string>('accessToken');

        if (!baseUrl || !token) {
            return [createConfigPromptItem()];
        }

        // If no team selected, prompt to configure
        if (!this.selectedTeamCsv) {
            const item = new vscode.TreeItem('Click to configure Team (enter Team OID or member IDs)', vscode.TreeItemCollapsibleState.None);
            item.command = { command: 'agility.changeTeam', title: 'Select Team' };
            item.tooltip = 'Click to select a team (enter a single Team OID like 12345 or comma-separated Member IDs like 12,34)';
            item.iconPath = new vscode.ThemeIcon('organization');
            return [item];
        }

        // Load tickets for selected team (members csv may be like "12,13,14" or a single id)
        if (this.tickets.length === 0) {
            this.loading = true;
            this._onDidChangeTreeData.fire(undefined);
            try {
                const api = await createApi(baseUrl, token, this.context);

                const raw = this.selectedTeamCsv;
                const entries = raw.split(',').map(s => s.trim()).filter(Boolean);
                const _ignoredStatuses: string = ignoredStatuses.reduce((acc, status, i) => acc += `Status!='StoryStatus:${status}'${i + 1 !== ignoredStatuses.length ? ';' : ''}`, '');

                // Helper to run the query given a where clause
                const runQuery = async (whereClause: string) => {
                    return api.get('/Data/PrimaryWorkitem', {
                        params: {
                            where: whereClause,
                            select: 'Name,Number,Status.Name,Estimate,Scope.Name,AssetType',
                            sort: '-ChangeDate'
                        }
                    });
                };

                let response: any;

                // If a single entry, prefer treating it as a Team OID (Team='Team:xxx')
                if (entries.length === 1) {
                    const single = entries[0];
                    // Normalize 'Team:123' -> '123'
                    const asTeamId = single.replace(/^Team:/i, '').trim();
                    if (asTeamId) {
                        const whereTeam = `Team='Team:${asTeamId}'${_ignoredStatuses.length ? `;${_ignoredStatuses}` : ''}`;
                        try {
                            response = await runQuery(whereTeam);
                        } catch (err) {
                            // If team query fails, we'll fall back to owner-based query below
                            response = undefined;
                        }
                        // If team query returned results, use them; otherwise fall back to owners
                        const assets = response?.data?.Assets || [];
                        if ((assets.length || 0) > 0) {
                            // we have results from team query
                            this.tickets = mapAssetsToTicketNodes(assets, baseUrl);
                        } else {
                            // Fall back to interpreting the single entry as a member id
                            const memberId = single.replace(/^Member:/i, '').trim();
                            const ownersExpr = `Owners='Member:${memberId}'`;
                            const whereOwners = `${ownersExpr}${_ignoredStatuses.length ? `;${_ignoredStatuses}` : ''}`;
                            response = await runQuery(whereOwners);
                            const assets2 = response.data.Assets || [];
                            if (assets2.length === 0) {
                                this.tickets = [new vscode.TreeItem(`Selected team has no open tickets`, vscode.TreeItemCollapsibleState.None) as any];
                                return this.tickets;
                            }
                            this.tickets = mapAssetsToTicketNodes(assets2, baseUrl);
                        }
                    }
                } else {
                    // Multiple entries: treat them as member ids and build Owners OR expression
                    const members = entries.map(s => s.replace(/^Member:/i, '').trim()).filter(Boolean);
                    const ownersExpr = members.map(id => `Owners='Member:${id}'`).join(',');
                    const whereOwners = `${ownersExpr}${_ignoredStatuses.length ? `;${_ignoredStatuses}` : ''}`;
                    response = await runQuery(whereOwners);
                    const assets = response.data.Assets || [];
                    if (assets.length === 0) {
                        this.tickets = [new vscode.TreeItem(`Selected team has no open tickets`, vscode.TreeItemCollapsibleState.None) as any];
                        return this.tickets;
                    }
                    this.tickets = mapAssetsToTicketNodes(assets, baseUrl);
                }

                const assets = response.data.Assets || [];
                if (assets.length === 0) {
                    this.tickets = [new vscode.TreeItem(`Selected team has no open tickets`, vscode.TreeItemCollapsibleState.None) as any];
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

        const header = buildTeamHeader(this.selectedTeamCsv || undefined);

        // Add search/filter item when a team is selected
        const searchItem = new vscode.TreeItem(
            this.currentFilter ? `Filter: ${this.currentFilter}` : 'Filter tickets...',
            vscode.TreeItemCollapsibleState.None
        );
        searchItem.command = { command: 'agility-team.filterTickets', title: 'Filter Tickets' };
        searchItem.iconPath = new vscode.ThemeIcon('search');

        if (this.tickets.length === 0 || !(this.tickets[0] instanceof TicketNode)) {
            return [header, searchItem, ...this.tickets];
        }

        const ticketsToShow = this.currentFilter && this.currentFilter.trim().length > 0
            ? (this.tickets as TicketNode[]).filter(t => {
                const q = this.currentFilter!.toLowerCase();
                return [t.label, t.number, t.status, t.project].some(field => (field || '').toLowerCase().includes(q));
            })
            : (this.tickets as TicketNode[]);

        if (ticketsToShow.length === 0) {
            const empty = new vscode.TreeItem('No tickets match filter', vscode.TreeItemCollapsibleState.None);
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><rect x="1" y="1" width="12" height="12" rx="2" fill="none" stroke="#888" stroke-width="1"/></svg>`;
            empty.iconPath = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
            empty.contextValue = 'empty';
            return [header, searchItem, empty];
        }

        const statusMap = groupTicketsByStatus(ticketsToShow);
        const statusNodes = createStatusNodes(statusMap);

        return [header, searchItem, ...statusNodes];
    }

    async changeTeam() {
        const config = vscode.workspace.getConfiguration('agility');
        const current = this.selectedTeamCsv || '';
        const entered = await vscode.window.showInputBox({
            prompt: 'Enter comma-separated Member IDs (e.g. 12,34) or a single Team OID',
            value: current,
            ignoreFocusOut: true
        });

        if (entered === undefined) { return; }
        await config.update('selectedTeam', entered?.trim() || null, true);
        this.selectedTeamCsv = entered?.trim() || null;
        this.tickets = [];
        this.refresh();
    }

    // Called from commands to open input and set filter for team view
    async changeFilter() {
        const input = await vscode.window.showInputBox({ prompt: 'Filter tickets (empty to clear)', value: this.currentFilter || '' });
        if (input === undefined) { return; }
        this.currentFilter = input.trim().length ? input.trim() : null;
        this.refresh();
    }

    async clearTeam() {
        const config = vscode.workspace.getConfiguration('agility');
        await config.update('selectedTeam', undefined, true);
        this.selectedTeamCsv = null;
        this.tickets = [];
        this.refresh();
    }
}

export default TeamTicketProvider;
