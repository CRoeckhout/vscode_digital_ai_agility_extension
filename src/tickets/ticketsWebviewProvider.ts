import * as vscode from 'vscode';
import { createApi } from '../agilityApi';
import { colors, unknownColor } from '../constants/colors';
import { getStatusConfig } from '../statusService';

/**
 * Represents a single ticket (workitem) from Agility
 */
interface TicketData {
  readonly label: string;
  readonly number: string;
  readonly assetId: string;
  readonly status: string;
  readonly project: string;
  readonly url: string;
  readonly assetType: string;
}

/**
 * Represents a group of tickets under a common status
 */
interface StatusGroup {
  readonly status: string;
  readonly color: string;
  readonly tickets: readonly TicketData[];
}

/**
 * Member information for the "My Tickets" mode
 */
interface MemberInfo {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly order: number;
}

/**
 * Team information for the "Team Tickets" mode
 */
interface TeamInfo {
  readonly id: string;
  readonly name: string;
  readonly order: number;
}

/**
 * View mode determines the behavior of the provider
 * - 'my-tickets': Single member selection with member picker
 * - 'team-tickets': Team OID or multiple member IDs
 */
type ViewMode = 'my-tickets' | 'team-tickets';

/**
 * Unified WebviewViewProvider for both "My Tickets" and "Team Tickets" views.
 * Avoids code duplication by parameterizing the view mode.
 */
export class TicketsWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private tickets: TicketData[] = [];
  private currentFilter = '';
  private loading = false;

  // My Tickets mode state
  private members: MemberInfo[] = [];
  private selectedMemberId: string | null = null;

  // Team Tickets mode state
  private teams: TeamInfo[] = [];
  private selectedTeamId: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly viewType: string,
    private readonly mode: ViewMode
  ) {
    const config = vscode.workspace.getConfiguration('agility');

    if (this.mode === 'my-tickets') {
      this.selectedMemberId = config.get<string>('selectedMember') ?? null;
    } else {
      this.selectedTeamId = config.get<string>('selectedTeam') ?? null;
    }

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('agility.instanceUrl') ||
        e.affectsConfiguration('agility.accessToken')
      ) {
        this.resetState();
        this.refresh();
      }
    });
  }

  private resetState(): void {
    this.tickets = [];
    this.members = [];
    this.teams = [];
    if (this.mode === 'my-tickets') {
      this.selectedMemberId = null;
    } else {
      this.selectedTeamId = null;
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(message);
    });

    this.updateWebview();
  }

  refresh(): void {
    this.tickets = [];
    this.updateWebview();
  }

  /**
   * Returns the currently selected member ID (for "My Tickets" mode).
   * Used by commands to assign the selected user as owner.
   */
  getSelectedMemberId(): string | null {
    return this.selectedMemberId;
  }

  // === Public methods for commands ===

  async changeMember(): Promise<void> {
    if (this.mode !== 'my-tickets') {
      return;
    }

    const config = vscode.workspace.getConfiguration('agility');
    const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
    const token = config.get<string>('accessToken');

    if (!baseUrl || !token) {
      vscode.window.showInformationMessage('Agility: Please configure instance URL and access token first');
      return;
    }

    if (this.members.length === 0) {
      await this.loadMembers(baseUrl, token);
    }

    if (this.members.length === 0) {
      vscode.window.showWarningMessage('Agility: No team members found.');
      return;
    }

    const selected = await vscode.window.showQuickPick(
      this.members.map((m) => ({ label: m.name, description: m.username, memberId: m.id })),
      { placeHolder: 'Select a team member to view their tickets' }
    );

    if (!selected) {
      return;
    }

    this.selectedMemberId = selected.memberId;
    await config.update('selectedMember', selected.memberId, true);
    this.tickets = [];
    this.refresh();
  }

  async clearMember(): Promise<void> {
    if (this.mode !== 'my-tickets') {
      return;
    }

    const config = vscode.workspace.getConfiguration('agility');
    await config.update('selectedMember', undefined, true);
    this.selectedMemberId = null;
    this.tickets = [];
    this.refresh();
  }

  async changeTeam(): Promise<void> {
    if (this.mode !== 'team-tickets') {
      return;
    }

    const config = vscode.workspace.getConfiguration('agility');
    const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
    const token = config.get<string>('accessToken');

    if (!baseUrl || !token) {
      vscode.window.showInformationMessage('Agility: Please configure instance URL and access token first');
      return;
    }

    if (this.teams.length === 0) {
      await this.loadTeams(baseUrl, token);
    }

    if (this.teams.length === 0) {
      vscode.window.showWarningMessage('Agility: No teams found.');
      return;
    }

    const selected = await vscode.window.showQuickPick(
      this.teams.map((t) => ({ label: t.name, teamId: t.id })),
      { placeHolder: 'Select a team to view their tickets' }
    );

    if (!selected) {
      return;
    }

    this.selectedTeamId = selected.teamId;
    await config.update('selectedTeam', selected.teamId, true);
    this.tickets = [];
    this.refresh();
  }

  async clearTeam(): Promise<void> {
    if (this.mode !== 'team-tickets') {
      return;
    }

    const config = vscode.workspace.getConfiguration('agility');
    await config.update('selectedTeam', undefined, true);
    this.selectedTeamId = null;
    this.tickets = [];
    this.refresh();
  }

  // === Message handling ===

  private async handleMessage(message: {
    type: string;
    filter?: string;
    url?: string;
    ticket?: TicketData;
    teamId?: string;
    memberId?: string;
  }): Promise<void> {
    switch (message.type) {
      case 'filter':
        this.currentFilter = message.filter ?? '';
        this.sendTicketsUpdate();
        break;

      case 'refresh':
        this.tickets = [];
        this.updateWebview();
        break;

      case 'openInBrowser':
        if (message.url) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;

      case 'openTicket':
        if (message.ticket) {
          await vscode.commands.executeCommand('agility.openTicket', message.ticket);
        }
        break;

      case 'createBranch':
        if (message.ticket) {
          await vscode.commands.executeCommand('agility.createBranch', message.ticket);
        }
        break;

      // My Tickets mode messages
      case 'changeMember':
        await this.changeMember();
        break;

      case 'clearMember':
        await this.clearMember();
        break;

      case 'setMember':
        if (message.memberId !== undefined) {
          const config = vscode.workspace.getConfiguration('agility');
          await config.update('selectedMember', message.memberId || null, true);
          this.selectedMemberId = message.memberId || null;
          this.tickets = [];
          this.updateWebview();
        }
        break;

      // Team Tickets mode messages
      case 'changeTeam':
        await this.changeTeam();
        break;

      case 'clearTeam':
        await this.clearTeam();
        break;

      case 'setTeam':
        if (message.teamId !== undefined) {
          const config = vscode.workspace.getConfiguration('agility');
          await config.update('selectedTeam', message.teamId || null, true);
          this.selectedTeamId = message.teamId || null;
          this.tickets = [];
          this.updateWebview();
        }
        break;
    }
  }

  // === Webview updates ===

  private sendTicketsUpdate(): void {
    if (!this.view) {
      return;
    }

    const filter = this.currentFilter.toLowerCase();
    const filteredTickets = filter
      ? this.tickets.filter((t) =>
          [t.label, t.number, t.status, t.project].some((field) =>
            field.toLowerCase().includes(filter)
          )
        )
      : this.tickets;

    const groups = this.groupTicketsByStatus(filteredTickets);

    this.view.webview.postMessage({
      type: 'updateTickets',
      groups,
      filter: this.currentFilter,
      hasFilter: filter.length > 0,
    });
  }

  private async updateWebview(): Promise<void> {
    if (!this.view) {
      return;
    }

    const config = vscode.workspace.getConfiguration('agility');
    const baseUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
    const token = config.get<string>('accessToken');

    // No configuration
    if (!baseUrl || !token) {
      this.view.webview.html = this.getConfigureHtml();
      return;
    }

    // Check if selection is needed
    if (this.mode === 'my-tickets') {
      // Load members if needed
      if (this.members.length === 0) {
        await this.loadMembers(baseUrl, token);
      }

      if (!this.selectedMemberId) {
        this.view.webview.html = this.getSelectMemberHtml();
        return;
      }
    } else {
      // Load teams if needed
      if (this.teams.length === 0) {
        await this.loadTeams(baseUrl, token);
      }

      if (!this.selectedTeamId) {
        this.view.webview.html = this.getSelectTeamHtml();
        return;
      }
    }

    // Load tickets if not loaded
    if (this.tickets.length === 0 && !this.loading) {
      this.loading = true;
      this.view.webview.html = this.getLoadingHtml();

      try {
        await this.loadTickets(baseUrl, token);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.view.webview.html = this.getErrorHtml(msg);
        this.loading = false;
        return;
      }
      this.loading = false;
    }

    // Render tickets
    this.view.webview.html = this.getTicketsHtml();
  }

  // === Data loading ===

  private async loadMembers(baseUrl: string, token: string): Promise<void> {
    try {
      const api = await createApi(baseUrl, token, this.context);
      const res = await api.get('/Data/Member', {
        params: { 
          select: 'Name,Username',
        },
      });

      this.members = (res.data.Assets ?? [])
        .map((a: Record<string, unknown>) => {
          const attrs: Record<string, unknown> = {};
          const attributes = a.Attributes as Record<string, { name: string; value: unknown }> | undefined;
          if (attributes) {
            for (const v of Object.values(attributes)) {
              attrs[v.name] = v.value;
            }
          }
          return {
            id: String(a.id ?? '').split(':')[1] ?? '',
            name: (attrs.Name as string) ?? (attrs.Username as string) ?? '',
            username: (attrs.Username as string) ?? '—',
            order: 0,
          };
        })
        .sort((a: MemberInfo, b: MemberInfo) => a.name.localeCompare(b.name));
    } catch {
      vscode.window.showWarningMessage('Could not load team members.');
      this.members = [];
    }
  }

  private async loadTeams(baseUrl: string, token: string): Promise<void> {
    try {
      const api = await createApi(baseUrl, token, this.context);
      const res = await api.get('/Data/Team', {
        params: { 
          select: 'Name',
        },
      });

      this.teams = (res.data.Assets ?? [])
        .map((a: Record<string, unknown>) => {
          const attrs: Record<string, unknown> = {};
          const attributes = a.Attributes as Record<string, { name: string; value: unknown }> | undefined;
          if (attributes) {
            for (const v of Object.values(attributes)) {
              attrs[v.name] = v.value;
            }
          }
          return {
            id: String(a.id ?? '').split(':')[1] ?? '',
            name: (attrs.Name as string) ?? 'Unnamed Team',
            order: 0,
          };
        })
        .sort((a: TeamInfo, b: TeamInfo) => a.name.localeCompare(b.name));
    } catch {
      vscode.window.showWarningMessage('Could not load teams.');
      this.teams = [];
    }
  }

  private async loadTickets(baseUrl: string, token: string): Promise<void> {
    const api = await createApi(baseUrl, token, this.context);

    const runQuery = async (whereClause: string) => {
      return api.get('/Data/PrimaryWorkitem', {
        params: {
          where: whereClause,
          select: 'Name,Number,Status.Name,Estimate,Scope.Name,AssetType',
          sort: '-ChangeDate',
        },
      });
    };

    let response: { data: { Assets: unknown[] } } | undefined;

    if (this.mode === 'my-tickets') {
      // Simple owner query for single member
      const ownersExpr = `Owners='Member:${this.selectedMemberId}'`;
      const whereClause = `${ownersExpr}`;
      response = await runQuery(whereClause);
      const assets = (response.data.Assets ?? []) as Record<string, unknown>[];
      this.tickets = this.mapAssetsToTickets(assets, baseUrl);
    } else {
      // Team mode: query by Team OID
      const teamId = this.selectedTeamId ?? '';
      const whereTeam = `Team='Team:${teamId}'`;
      response = await runQuery(whereTeam);
      const assets = (response.data.Assets ?? []) as Record<string, unknown>[];
      this.tickets = this.mapAssetsToTickets(assets, baseUrl);
    }
  }

  private mapAssetsToTickets(assets: Record<string, unknown>[], baseUrl: string): TicketData[] {
    return assets.map((asset) => {
      const attrs: Record<string, unknown> = {};
      const attributes = asset.Attributes as Record<string, { name: string; value: unknown }> | undefined;
      if (attributes) {
        for (const a of Object.values(attributes)) {
          attrs[a.name] = a.value;
        }
      }

      const id = String(asset.id ?? '');
      const number = (attrs.Number as string) ?? id.split(':').pop() ?? '';
      const assetId = id.split(':').pop() ?? '';
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

  private groupTicketsByStatus(tickets: readonly TicketData[]): StatusGroup[] {
    const statusMap = new Map<string, TicketData[]>();
    for (const t of tickets) {
      const key = t.status || 'Unknown';
      if (!statusMap.has(key)) {
        statusMap.set(key, []);
      }
      statusMap.get(key)!.push(t);
    }

    // Get configured status colors
    const statusConfig = getStatusConfig();

    // Sort statuses by their configured order, with Unknown/unconfigured at the end
    // Also filter out hidden statuses
    const statuses = Array.from(statusMap.keys())
      .filter((s) => {
        // Keep Unknown status
        if (s === 'Unknown' || s === '—') {
          return true;
        }
        // Check if status is hidden in config
        const configEntry = Object.values(statusConfig).find((cfg) => cfg.name === s);
        return !(configEntry?.hidden);
      })
      .sort((a, b) => {
        // Unknown always goes last
        if (a === 'Unknown' || a === '—') {
          return 1;
        }
        if (b === 'Unknown' || b === '—') {
          return -1;
        }

        // Find order from config by matching status name
        const configA = Object.values(statusConfig).find((cfg) => cfg.name === a);
        const configB = Object.values(statusConfig).find((cfg) => cfg.name === b);

        const orderA = configA?.order ?? Number.MAX_SAFE_INTEGER;
        const orderB = configB?.order ?? Number.MAX_SAFE_INTEGER;

        // Sort by order, then alphabetically as fallback
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.localeCompare(b);
      });

    return statuses.map((s, idx) => {
      // Try to find configured color by matching status name
      let color = unknownColor;

      if (s === 'Unknown' || s === '—') {
        color = unknownColor;
      } else {
        // Look for a matching status in config by name
        const configEntry = Object.values(statusConfig).find((cfg) => cfg.name === s);
        if (configEntry) {
          color = configEntry.color;
        } else {
          // Fall back to default color cycling
          color = colors[idx % colors.length] ?? unknownColor;
        }
      }

      return { status: s, color, tickets: statusMap.get(s)! };
    });
  }

  // === HTML Rendering ===

  private escapeHtml(input: unknown): string {
    if (input === undefined || input === null) {
      return '';
    }
    const raw = Array.isArray(input) ? input.join(', ') : String(input);
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getBaseStyles(): string {
    return `
      <style>
        :root {
          --vscode-font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif);
        }
        * {
          box-sizing: border-box;
        }
        body {
          font-family: var(--vscode-font-family);
          font-size: 13px;
          padding: 0;
          margin: 0;
          color: var(--vscode-foreground);
          background: var(--vscode-sideBar-background);
        }
        .container {
          padding: 4px 8px;
        }
        .search-container {
          position: sticky;
          top: 0;
          background: var(--vscode-sideBar-background);
          padding: 4px 8px;
          border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
          z-index: 10;
        }
        .search-wrapper {
          display: flex;
          align-items: center;
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, transparent);
          border-radius: 3px;
          padding: 0 6px;
        }
        .search-wrapper:focus-within {
          border-color: var(--vscode-focusBorder);
          outline: none;
        }
        .search-icon {
          color: var(--vscode-input-placeholderForeground);
          margin-right: 4px;
          flex-shrink: 0;
        }
        .search-input {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--vscode-input-foreground);
          font-size: 13px;
          padding: 4px 0;
          outline: none;
        }
        .search-input::placeholder {
          color: var(--vscode-input-placeholderForeground);
        }
        .clear-btn {
          background: none;
          border: none;
          color: var(--vscode-input-placeholderForeground);
          cursor: pointer;
          padding: 1px 3px;
          display: flex;
          align-items: center;
          border-radius: 2px;
        }
        .clear-btn:hover {
          background: var(--vscode-toolbar-hoverBackground);
          color: var(--vscode-foreground);
        }
        .header {
          display: flex;
          align-items: center;
          padding: 3px 0;
          margin-bottom: 2px;
          cursor: pointer;
          border-radius: 3px;
        }
        .header:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .header-icon {
          margin-right: 6px;
          color: var(--vscode-foreground);
        }
        .header-text {
          flex: 1;
          font-weight: 500;
        }
        .header-action {
          background: none;
          border: none;
          color: var(--vscode-foreground);
          cursor: pointer;
          padding: 2px;
          border-radius: 2px;
          display: flex;
          align-items: center;
        }
        .header-action:hover {
          background: var(--vscode-toolbar-hoverBackground);
        }
        .status-group {
          margin-bottom: 2px;
        }
        .status-header {
          display: flex;
          align-items: center;
          padding: 2px 0;
          cursor: pointer;
          user-select: none;
        }
        .status-header:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
          flex-shrink: 0;
        }
        .status-name {
          flex: 1;
          font-weight: 500;
        }
        .status-count {
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
        }
        .chevron {
          margin-right: 2px;
          transition: transform 0.15s ease;
          transform: rotate(90deg);
        }
        .chevron.collapsed {
          transform: rotate(0deg);
        }
        .tickets {
          margin-left: 14px;
          overflow: hidden;
        }
        .tickets.collapsed {
          display: none;
        }
        .ticket {
          display: flex;
          align-items: center;
          padding: 2px 4px;
          cursor: pointer;
          border-radius: 3px;
          margin: 0;
        }
        .ticket:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .ticket-icon {
          margin-right: 6px;
          flex-shrink: 0;
        }
        .ticket-label {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ticket-meta {
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          margin-left: 6px;
          white-space: nowrap;
        }
        .ticket-actions {
          display: none;
          margin-left: 2px;
        }
        .ticket:hover .ticket-actions {
          display: flex;
        }
        .ticket-action {
          background: none;
          border: none;
          color: var(--vscode-foreground);
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 3px;
          display: flex;
          align-items: center;
        }
        .ticket-action:hover {
          background: var(--vscode-toolbar-hoverBackground);
        }
        .empty-state {
          text-align: center;
          padding: 24px 16px;
          color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon {
          font-size: 32px;
          margin-bottom: 8px;
          opacity: 0.6;
        }
        .btn {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          margin-top: 12px;
        }
        .btn:hover {
          background: var(--vscode-button-hoverBackground);
        }
        .input-container {
          margin-top: 12px;
        }
        .text-input {
          width: 100%;
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, transparent);
          border-radius: 4px;
          padding: 6px 8px;
          color: var(--vscode-input-foreground);
          font-size: 13px;
          outline: none;
        }
        .text-input:focus {
          border-color: var(--vscode-focusBorder);
        }
        .text-input::placeholder {
          color: var(--vscode-input-placeholderForeground);
        }
        .member-list {
          max-height: 300px;
          overflow-y: auto;
          margin-top: 8px;
        }
        .member-item {
          display: flex;
          align-items: center;
          padding: 6px 8px;
          cursor: pointer;
          border-radius: 4px;
        }
        .member-item:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .member-name {
          flex: 1;
          font-weight: 500;
        }
        .member-username {
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
        }
        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          color: var(--vscode-descriptionForeground);
        }
        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid var(--vscode-foreground);
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 8px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
  }

  private getSvgIcons(): { story: string; defect: string; ticket: string } {
    return {
      story: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="12" height="12" rx="2" fill="#4CAF50"/><path d="M5 8L7 10L11 6" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      defect: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="12" height="12" rx="2" fill="#F44336"/><circle cx="8" cy="8" r="3" stroke="white" stroke-width="1.5"/></svg>`,
      ticket: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="12" height="10" rx="2" fill="#2196F3"/><path d="M5 6H11M5 9H9" stroke="white" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    };
  }

  private getLoadingHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${this.getBaseStyles()}
      </head>
      <body>
        <div class="loading">
          <div class="spinner"></div>
          <span>Loading tickets...</span>
        </div>
      </body>
      </html>
    `;
  }

  private getConfigureHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${this.getBaseStyles()}
      </head>
      <body>
        <div class="empty-state">
          <div class="empty-state-icon">⚙️</div>
          <div>Agility not configured</div>
          <div style="margin-top: 4px; font-size: 12px;">Set your instance URL and access token in settings</div>
        </div>
      </body>
      </html>
    `;
  }

  private getSelectMemberHtml(): string {
    const membersHtml = this.members
      .map(
        (m) => `
        <div class="member-item" onclick="selectMember('${m.id}')">
          <span class="member-name">${this.escapeHtml(m.name)}</span>
          <span class="member-username">${this.escapeHtml(m.username)}</span>
        </div>
      `
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${this.getBaseStyles()}
      </head>
      <body>
        <div class="container">
          <div class="empty-state" style="padding-bottom: 8px;">
            <div class="empty-state-icon">👤</div>
            <div>Select a team member</div>
            <div style="margin-top: 4px; font-size: 12px;">Choose whose tickets to view</div>
          </div>
          <div class="input-container">
            <input type="text" class="text-input" id="memberSearch" placeholder="Search members...">
          </div>
          <div class="member-list" id="memberList">
            ${membersHtml}
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          const memberSearch = document.getElementById('memberSearch');
          const memberList = document.getElementById('memberList');
          const allMembers = ${JSON.stringify(this.members)};

          memberSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = allMembers.filter(m =>
              m.name.toLowerCase().includes(query) || m.username.toLowerCase().includes(query)
            );
            memberList.innerHTML = filtered.map(m => \`
              <div class="member-item" onclick="selectMember('\${m.id}')">
                <span class="member-name">\${escapeHtml(m.name)}</span>
                <span class="member-username">\${escapeHtml(m.username)}</span>
              </div>
            \`).join('');
          });

          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          function selectMember(memberId) {
            vscode.postMessage({ type: 'setMember', memberId });
          }
        </script>
      </body>
      </html>
    `;
  }

  private getSelectTeamHtml(): string {
    const teamsHtml = this.teams
      .map(
        (t) => `
        <div class="member-item" onclick="selectTeam('${t.id}')">
          <span class="member-name">${this.escapeHtml(t.name)}</span>
        </div>
      `
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${this.getBaseStyles()}
      </head>
      <body>
        <div class="container">
          <div class="empty-state" style="padding-bottom: 8px;">
            <div class="empty-state-icon">👥</div>
            <div>Select a team</div>
            <div style="margin-top: 4px; font-size: 12px;">Choose a team to view their tickets</div>
          </div>
          <div class="input-container">
            <input type="text" class="text-input" id="teamSearch" placeholder="Search teams...">
          </div>
          <div class="member-list" id="teamList">
            ${teamsHtml}
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          const teamSearch = document.getElementById('teamSearch');
          const teamList = document.getElementById('teamList');
          const allTeams = ${JSON.stringify(this.teams)};

          teamSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = allTeams.filter(t =>
              t.name.toLowerCase().includes(query)
            );
            teamList.innerHTML = filtered.map(t => \`
              <div class="member-item" onclick="selectTeam('\${t.id}')">
                <span class="member-name">\${escapeHtml(t.name)}</span>
              </div>
            \`).join('');
          });

          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          function selectTeam(teamId) {
            vscode.postMessage({ type: 'setTeam', teamId });
          }
        </script>
      </body>
      </html>
    `;
  }

  private getErrorHtml(message: string): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${this.getBaseStyles()}
      </head>
      <body>
        <div class="container">
          <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <div style="color: var(--vscode-errorForeground);">Error loading tickets</div>
            <div style="margin-top: 4px; font-size: 12px;">${this.escapeHtml(message)}</div>
            <button class="btn" id="retryBtn">Retry</button>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('retryBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
          });
        </script>
      </body>
      </html>
    `;
  }

  private getTicketsHtml(): string {
    const icons = this.getSvgIcons();
    const filter = this.currentFilter.toLowerCase();

    // Filter tickets
    const filteredTickets = filter
      ? this.tickets.filter((t) =>
          [t.label, t.number, t.status, t.project].some((field) =>
            field.toLowerCase().includes(filter)
          )
        )
      : this.tickets;

    // Group by status
    const groups = this.groupTicketsByStatus(filteredTickets);

    // Header label and actions based on mode
    const headerLabel = this.mode === 'my-tickets'
      ? this.getMemberName()
      : this.getTeamName();

    const headerIcon = this.mode === 'my-tickets'
      ? `<svg class="header-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>`
      : `<svg class="header-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>`;

    const changeAction = this.mode === 'my-tickets' ? 'changeMember' : 'changeTeam';
    const clearAction = this.mode === 'my-tickets' ? 'clearMember' : 'clearTeam';

    // Build HTML for groups
    let groupsHtml = '';
    if (filteredTickets.length === 0) {
      groupsHtml = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div>${filter ? 'No tickets match filter' : 'No tickets found'}</div>
        </div>
      `;
    } else {
      for (const group of groups) {
        const ticketsHtml = group.tickets
          .map((t) => {
            const firstChar = t.label.charAt(0).toUpperCase();
            let iconSvg = icons.ticket;
            if (firstChar === 'S') {
              iconSvg = icons.story;
            } else if (firstChar === 'D') {
              iconSvg = icons.defect;
            }

            const ticketData = JSON.stringify(t).replace(/'/g, "\\'");

            return `
              <div class="ticket" onclick='openTicket(${ticketData})'>
                <span class="ticket-icon">${iconSvg}</span>
                <span class="ticket-label" title="${this.escapeHtml(t.label)}">${this.escapeHtml(t.label)}</span>
                <div class="ticket-actions">
                  <button class="ticket-action" title="Open in browser" onclick="event.stopPropagation(); openInBrowser('${this.escapeHtml(t.url)}')">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h6v1.5h-5v11h11v-5H15v6.5H.5V1h1zm6.5 6L14 1h-4V0h6v6h-1V2L9.5 8 8 6.5z"/></svg>
                  </button>
                  <button class="ticket-action" title="Create branch" onclick='event.stopPropagation(); createBranch(${ticketData})'>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM5 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM3.5 5v5.5a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V5h1v5.5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V5h1z"/></svg>
                  </button>
                </div>
              </div>
            `;
          })
          .join('');

        groupsHtml += `
          <div class="status-group">
            <div class="status-header" onclick="toggleGroup(this)">
              <svg class="chevron collapsed" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.8l.7-.7 5.3 5.3-5.3 5.3z"/></svg>
              <span class="status-dot" style="background-color: ${group.color}"></span>
              <span class="status-name">${this.escapeHtml(group.status)}</span>
              <span class="status-count">${group.tickets.length}</span>
            </div>
            <div class="tickets collapsed">
              ${ticketsHtml}
            </div>
          </div>
        `;
      }
    }

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${this.getBaseStyles()}
      </head>
      <body>
        <div class="search-container">
          <div class="search-wrapper">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
            </svg>
            <input type="text" class="search-input" id="searchInput" placeholder="Filter tickets..." value="${this.escapeHtml(this.currentFilter)}">
            <button class="clear-btn" id="clearBtn" title="Clear filter" style="display: ${this.currentFilter ? 'flex' : 'none'}">✕</button>
          </div>
        </div>
        <div class="container">
          <div class="header" onclick="${changeAction}()">
            ${headerIcon}
            <span class="header-text">${this.escapeHtml(headerLabel)} • Click to change</span>
            <button class="header-action" title="Clear selection" onclick="event.stopPropagation(); ${clearAction}()">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
            </button>
            <button class="header-action" title="Refresh" onclick="event.stopPropagation(); refresh()">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
            </button>
          </div>
          <div id="ticketsContent">${groupsHtml}</div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();

          const icons = {
            story: \`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="12" height="12" rx="2" fill="#4CAF50"/><path d="M5 8L7 10L11 6" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\`,
            defect: \`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="12" height="12" rx="2" fill="#F44336"/><circle cx="8" cy="8" r="3" stroke="white" stroke-width="1.5"/></svg>\`,
            ticket: \`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="12" height="10" rx="2" fill="#2196F3"/><path d="M5 6H11M5 9H9" stroke="white" stroke-width="1.2" stroke-linecap="round"/></svg>\`
          };

          const searchInput = document.getElementById('searchInput');
          const clearBtn = document.getElementById('clearBtn');
          const ticketsContent = document.getElementById('ticketsContent');

          let debounceTimer;
          searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              vscode.postMessage({ type: 'filter', filter: e.target.value });
            }, 200);
          });

          clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            vscode.postMessage({ type: 'filter', filter: '' });
          });

          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          function renderGroups(groups, hasFilter) {
            if (groups.length === 0) {
              return \`
                <div class="empty-state">
                  <div class="empty-state-icon">🔍</div>
                  <div>\${hasFilter ? 'No tickets match filter' : 'No tickets found'}</div>
                </div>
              \`;
            }

            return groups.map(group => {
              const ticketsHtml = group.tickets.map(t => {
                const firstChar = t.label.charAt(0).toUpperCase();
                let iconSvg = icons.ticket;
                if (firstChar === 'S') iconSvg = icons.story;
                else if (firstChar === 'D') iconSvg = icons.defect;

                const ticketData = JSON.stringify(t).replace(/'/g, "\\\\'");

                return \`
                  <div class="ticket" onclick='openTicket(\${ticketData})'>
                    <span class="ticket-icon">\${iconSvg}</span>
                    <span class="ticket-label" title="\${escapeHtml(t.label)}">\${escapeHtml(t.label)}</span>
                    <div class="ticket-actions">
                      <button class="ticket-action" title="Open in browser" onclick="event.stopPropagation(); openInBrowser('\${escapeHtml(t.url)}')">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h6v1.5h-5v11h11v-5H15v6.5H.5V1h1zm6.5 6L14 1h-4V0h6v6h-1V2L9.5 8 8 6.5z"/></svg>
                      </button>
                      <button class="ticket-action" title="Create branch" onclick='event.stopPropagation(); createBranch(\${ticketData})'>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM5 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM3.5 5v5.5a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V5h1v5.5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V5h1z"/></svg>
                      </button>
                    </div>
                  </div>
                \`;
              }).join('');

              return \`
                <div class="status-group">
                  <div class="status-header" onclick="toggleGroup(this)">
                    <svg class="chevron collapsed" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.8l.7-.7 5.3 5.3-5.3 5.3z"/></svg>
                    <span class="status-dot" style="background-color: \${group.color}"></span>
                    <span class="status-name">\${escapeHtml(group.status)}</span>
                    <span class="status-count">\${group.tickets.length}</span>
                  </div>
                  <div class="tickets collapsed">
                    \${ticketsHtml}
                  </div>
                </div>
              \`;
            }).join('');
          }

          // Handle messages from the extension
          window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateTickets') {
              ticketsContent.innerHTML = renderGroups(message.groups, message.hasFilter);
              clearBtn.style.display = message.hasFilter ? 'flex' : 'none';
            }
          });

          function toggleGroup(header) {
            const chevron = header.querySelector('.chevron');
            const tickets = header.nextElementSibling;
            chevron.classList.toggle('collapsed');
            tickets.classList.toggle('collapsed');
          }

          function openTicket(ticket) {
            vscode.postMessage({ type: 'openTicket', ticket });
          }

          function openInBrowser(url) {
            vscode.postMessage({ type: 'openInBrowser', url });
          }

          function createBranch(ticket) {
            vscode.postMessage({ type: 'createBranch', ticket });
          }

          function changeMember() {
            vscode.postMessage({ type: 'changeMember' });
          }

          function clearMember() {
            vscode.postMessage({ type: 'clearMember' });
          }

          function changeTeam() {
            vscode.postMessage({ type: 'changeTeam' });
          }

          function clearTeam() {
            vscode.postMessage({ type: 'clearTeam' });
          }

          function refresh() {
            vscode.postMessage({ type: 'refresh' });
          }
        </script>
      </body>
      </html>
    `;
  }

  private getMemberName(): string {
    const member = this.members.find((m) => m.id === this.selectedMemberId);
    return member?.name ?? 'Unknown';
  }

  private getTeamName(): string {
    const team = this.teams.find((t) => t.id === this.selectedTeamId);
    return team?.name ?? 'Unknown Team';
  }
}
