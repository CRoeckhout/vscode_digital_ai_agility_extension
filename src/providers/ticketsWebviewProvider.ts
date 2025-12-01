/**
 * Unified WebviewViewProvider for both "My Tickets" and "Team Tickets" views.
 * Uses the new API services and shared utilities.
 */

import * as vscode from 'vscode';
import { fetchTicketsByMember, fetchTicketsByTeam, fetchMembers, fetchTeams } from '../api';
import {
  getSelectedMemberId,
  setSelectedMemberId,
  getSelectedTeamId,
  setSelectedTeamId,
  isConfigured,
  getStatusConfig,
} from '../config';
import { getErrorMessage, ConfigurationError } from '../errors';
import { escapeHtml } from '../utils';
import { TicketData, StatusGroup, MemberInfo, TeamInfo } from '../models';
import { colors, unknownColor } from '../constants/colors';

/**
 * View mode determines the behavior of the provider.
 */
type ViewMode = 'my-tickets' | 'team-tickets';

/**
 * Unified WebviewViewProvider for both "My Tickets" and "Team Tickets" views.
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
    if (this.mode === 'my-tickets') {
      this.selectedMemberId = getSelectedMemberId();
    } else {
      this.selectedTeamId = getSelectedTeamId();
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
   */
  getSelectedMemberId(): string | null {
    return this.selectedMemberId;
  }

  // === Public methods for commands ===

  async changeMember(): Promise<void> {
    if (this.mode !== 'my-tickets') {
      return;
    }

    if (!isConfigured()) {
      vscode.window.showInformationMessage('Agility: Please configure instance URL and access token first');
      return;
    }

    if (this.members.length === 0) {
      await this.loadMembers();
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
    await setSelectedMemberId(selected.memberId);
    this.tickets = [];
    this.refresh();
  }

  async clearMember(): Promise<void> {
    if (this.mode !== 'my-tickets') {
      return;
    }

    await setSelectedMemberId(null);
    this.selectedMemberId = null;
    this.tickets = [];
    this.refresh();
  }

  async changeTeam(): Promise<void> {
    if (this.mode !== 'team-tickets') {
      return;
    }

    if (!isConfigured()) {
      vscode.window.showInformationMessage('Agility: Please configure instance URL and access token first');
      return;
    }

    if (this.teams.length === 0) {
      await this.loadTeams();
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
    await setSelectedTeamId(selected.teamId);
    this.tickets = [];
    this.refresh();
  }

  async clearTeam(): Promise<void> {
    if (this.mode !== 'team-tickets') {
      return;
    }

    await setSelectedTeamId(null);
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

      case 'changeMember':
        await this.changeMember();
        break;

      case 'clearMember':
        await this.clearMember();
        break;

      case 'setMember':
        if (message.memberId !== undefined) {
          await setSelectedMemberId(message.memberId || null);
          this.selectedMemberId = message.memberId || null;
          this.tickets = [];
          this.updateWebview();
        }
        break;

      case 'changeTeam':
        await this.changeTeam();
        break;

      case 'clearTeam':
        await this.clearTeam();
        break;

      case 'setTeam':
        if (message.teamId !== undefined) {
          await setSelectedTeamId(message.teamId || null);
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

    if (!isConfigured()) {
      this.view.webview.html = this.getConfigureHtml();
      return;
    }

    if (this.mode === 'my-tickets') {
      if (this.members.length === 0) {
        await this.loadMembers();
      }

      if (!this.selectedMemberId) {
        this.view.webview.html = this.getSelectMemberHtml();
        return;
      }
    } else {
      if (this.teams.length === 0) {
        await this.loadTeams();
      }

      if (!this.selectedTeamId) {
        this.view.webview.html = this.getSelectTeamHtml();
        return;
      }
    }

    if (this.tickets.length === 0 && !this.loading) {
      this.loading = true;
      this.view.webview.html = this.getLoadingHtml();

      try {
        await this.loadTickets();
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        this.view.webview.html = this.getErrorHtml(msg);
        this.loading = false;
        return;
      }
      this.loading = false;
    }

    this.view.webview.html = this.getTicketsHtml();
  }

  // === Data loading ===

  private async loadMembers(): Promise<void> {
    try {
      this.members = await fetchMembers(this.context);
    } catch (error) {
      if (!(error instanceof ConfigurationError)) {
        vscode.window.showWarningMessage('Could not load team members.');
      }
      this.members = [];
    }
  }

  private async loadTeams(): Promise<void> {
    try {
      this.teams = await fetchTeams(this.context);
    } catch (error) {
      if (!(error instanceof ConfigurationError)) {
        vscode.window.showWarningMessage('Could not load teams.');
      }
      this.teams = [];
    }
  }

  private async loadTickets(): Promise<void> {
    if (this.mode === 'my-tickets' && this.selectedMemberId) {
      this.tickets = await fetchTicketsByMember(this.context, this.selectedMemberId);
    } else if (this.mode === 'team-tickets' && this.selectedTeamId) {
      this.tickets = await fetchTicketsByTeam(this.context, this.selectedTeamId);
    }
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

    const statusConfig = getStatusConfig();

    // Sort and filter statuses
    const statuses = Array.from(statusMap.keys())
      .filter((s) => {
        if (s === 'Unknown' || s === '—') {
          return true;
        }
        const configEntry = Object.values(statusConfig).find((cfg) => cfg.name === s);
        return !(configEntry?.hidden);
      })
      .sort((a, b) => {
        if (a === 'Unknown' || a === '—') {return 1;}
        if (b === 'Unknown' || b === '—') {return -1;}

        const configA = Object.values(statusConfig).find((cfg) => cfg.name === a);
        const configB = Object.values(statusConfig).find((cfg) => cfg.name === b);

        const orderA = configA?.order ?? Number.MAX_SAFE_INTEGER;
        const orderB = configB?.order ?? Number.MAX_SAFE_INTEGER;

        if (orderA !== orderB) {return orderA - orderB;}
        return a.localeCompare(b);
      });

    return statuses.map((s, idx) => {
      let color = unknownColor;

      if (s !== 'Unknown' && s !== '—') {
        const configEntry = Object.values(statusConfig).find((cfg) => cfg.name === s);
        if (configEntry) {
          color = configEntry.color;
        } else {
          color = colors[idx % colors.length] ?? unknownColor;
        }
      }

      return { status: s, color, tickets: statusMap.get(s)! };
    });
  }

  // === HTML Rendering ===

  private getBaseStyles(): string {
    return `
      <style>
        :root {
          --vscode-font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif);
        }
        * { box-sizing: border-box; }
        body {
          font-family: var(--vscode-font-family);
          font-size: 13px;
          padding: 0;
          margin: 0;
          color: var(--vscode-foreground);
          background: var(--vscode-sideBar-background);
        }
        .container { padding: 4px 8px; }
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
        .header:hover { background: var(--vscode-list-hoverBackground); }
        .header-icon { margin-right: 6px; color: var(--vscode-foreground); }
        .header-text { flex: 1; font-weight: 500; }
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
        .header-action:hover { background: var(--vscode-toolbar-hoverBackground); }
        .status-group { margin-bottom: 2px; }
        .status-header {
          display: flex;
          align-items: center;
          padding: 2px 0;
          cursor: pointer;
          user-select: none;
        }
        .status-header:hover { background: var(--vscode-list-hoverBackground); }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
          flex-shrink: 0;
        }
        .status-name { flex: 1; font-weight: 500; }
        .status-count { color: var(--vscode-descriptionForeground); font-size: 12px; }
        .chevron {
          margin-right: 2px;
          transition: transform 0.15s ease;
          transform: rotate(90deg);
        }
        .chevron.collapsed { transform: rotate(0deg); }
        .tickets { margin-left: 14px; overflow: hidden; }
        .tickets.collapsed { display: none; }
        .ticket {
          display: flex;
          align-items: center;
          padding: 2px 4px;
          cursor: pointer;
          border-radius: 3px;
          margin: 0;
        }
        .ticket:hover { background: var(--vscode-list-hoverBackground); }
        .ticket-icon { margin-right: 6px; flex-shrink: 0; }
        .ticket-label {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ticket-actions { display: none; margin-left: 2px; }
        .ticket:hover .ticket-actions { display: flex; }
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
        .ticket-action:hover { background: var(--vscode-toolbar-hoverBackground); }
        .empty-state {
          text-align: center;
          padding: 24px 16px;
          color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon { font-size: 32px; margin-bottom: 8px; opacity: 0.6; }
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
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .input-container { margin-top: 12px; }
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
        .text-input:focus { border-color: var(--vscode-focusBorder); }
        .text-input::placeholder { color: var(--vscode-input-placeholderForeground); }
        .member-list { max-height: 300px; overflow-y: auto; margin-top: 8px; }
        .member-item {
          display: flex;
          align-items: center;
          padding: 6px 8px;
          cursor: pointer;
          border-radius: 4px;
        }
        .member-item:hover { background: var(--vscode-list-hoverBackground); }
        .member-name { flex: 1; font-weight: 500; }
        .member-username { color: var(--vscode-descriptionForeground); font-size: 12px; }
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
        @keyframes spin { to { transform: rotate(360deg); } }
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
    return `<!DOCTYPE html>
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
</html>`;
  }

  private getConfigureHtml(): string {
    return `<!DOCTYPE html>
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
</html>`;
  }

  private getSelectMemberHtml(): string {
    const membersHtml = this.members
      .map((m) => `
        <div class="member-item" onclick="selectMember('${m.id}')">
          <span class="member-name">${escapeHtml(m.name)}</span>
          <span class="member-username">${escapeHtml(m.username)}</span>
        </div>
      `)
      .join('');

    return `<!DOCTYPE html>
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
    <div class="member-list" id="memberList">${membersHtml}</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const allMembers = ${JSON.stringify(this.members)};

    document.getElementById('memberSearch').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const filtered = allMembers.filter(m =>
        m.name.toLowerCase().includes(query) || m.username.toLowerCase().includes(query)
      );
      document.getElementById('memberList').innerHTML = filtered.map(m => 
        '<div class="member-item" onclick="selectMember(\\'' + m.id + '\\')">' +
        '<span class="member-name">' + escapeHtml(m.name) + '</span>' +
        '<span class="member-username">' + escapeHtml(m.username) + '</span></div>'
      ).join('');
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
</html>`;
  }

  private getSelectTeamHtml(): string {
    const teamsHtml = this.teams
      .map((t) => `
        <div class="member-item" onclick="selectTeam('${t.id}')">
          <span class="member-name">${escapeHtml(t.name)}</span>
        </div>
      `)
      .join('');

    return `<!DOCTYPE html>
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
    <div class="member-list" id="teamList">${teamsHtml}</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const allTeams = ${JSON.stringify(this.teams)};

    document.getElementById('teamSearch').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const filtered = allTeams.filter(t => t.name.toLowerCase().includes(query));
      document.getElementById('teamList').innerHTML = filtered.map(t =>
        '<div class="member-item" onclick="selectTeam(\\'' + t.id + '\\')">' +
        '<span class="member-name">' + escapeHtml(t.name) + '</span></div>'
      ).join('');
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
</html>`;
  }

  private getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
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
      <div style="margin-top: 4px; font-size: 12px;">${escapeHtml(message)}</div>
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
</html>`;
  }

  private getTicketsHtml(): string {
    const icons = this.getSvgIcons();
    const filter = this.currentFilter.toLowerCase();

    const filteredTickets = filter
      ? this.tickets.filter((t) =>
          [t.label, t.number, t.status, t.project].some((field) =>
            field.toLowerCase().includes(filter)
          )
        )
      : this.tickets;

    const groups = this.groupTicketsByStatus(filteredTickets);

    const headerLabel = this.mode === 'my-tickets'
      ? this.getMemberName()
      : this.getTeamName();

    const headerIcon = `<svg class="header-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>`;

    const changeAction = this.mode === 'my-tickets' ? 'changeMember' : 'changeTeam';
    const clearAction = this.mode === 'my-tickets' ? 'clearMember' : 'clearTeam';

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
            if (firstChar === 'S') {iconSvg = icons.story;}
            else if (firstChar === 'D') {iconSvg = icons.defect;}

            const ticketData = JSON.stringify(t).replace(/'/g, "\\'");

            return `
              <div class="ticket" onclick='openTicket(${ticketData})'>
                <span class="ticket-icon">${iconSvg}</span>
                <span class="ticket-label" title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</span>
                <div class="ticket-actions">
                  <button class="ticket-action" title="Open in browser" onclick="event.stopPropagation(); openInBrowser('${escapeHtml(t.url)}')">
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
              <span class="status-name">${escapeHtml(group.status)}</span>
              <span class="status-count">${group.tickets.length}</span>
            </div>
            <div class="tickets collapsed">${ticketsHtml}</div>
          </div>
        `;
      }
    }

    return `<!DOCTYPE html>
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
      <input type="text" class="search-input" id="searchInput" placeholder="Filter tickets..." value="${escapeHtml(this.currentFilter)}">
      <button class="clear-btn" id="clearBtn" title="Clear filter" style="display: ${this.currentFilter ? 'flex' : 'none'}">✕</button>
    </div>
  </div>
  <div class="container">
    <div class="header" onclick="${changeAction}()">
      ${headerIcon}
      <span class="header-text">${escapeHtml(headerLabel)} • Click to change</span>
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

    document.getElementById('searchInput').addEventListener('input', (e) => {
      clearTimeout(window.debounceTimer);
      window.debounceTimer = setTimeout(() => {
        vscode.postMessage({ type: 'filter', filter: e.target.value });
      }, 200);
    });

    document.getElementById('clearBtn').addEventListener('click', () => {
      document.getElementById('searchInput').value = '';
      document.getElementById('clearBtn').style.display = 'none';
      vscode.postMessage({ type: 'filter', filter: '' });
    });

    function toggleGroup(header) {
      header.querySelector('.chevron').classList.toggle('collapsed');
      header.nextElementSibling.classList.toggle('collapsed');
    }

    function openTicket(ticket) { vscode.postMessage({ type: 'openTicket', ticket }); }
    function openInBrowser(url) { vscode.postMessage({ type: 'openInBrowser', url }); }
    function createBranch(ticket) { vscode.postMessage({ type: 'createBranch', ticket }); }
    function changeMember() { vscode.postMessage({ type: 'changeMember' }); }
    function clearMember() { vscode.postMessage({ type: 'clearMember' }); }
    function changeTeam() { vscode.postMessage({ type: 'changeTeam' }); }
    function clearTeam() { vscode.postMessage({ type: 'clearTeam' }); }
    function refresh() { vscode.postMessage({ type: 'refresh' }); }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'updateTickets') {
        document.getElementById('clearBtn').style.display = message.hasFilter ? 'flex' : 'none';
      }
    });
  </script>
</body>
</html>`;
  }

  private getMemberName(): string {
    return this.members.find((m) => m.id === this.selectedMemberId)?.name ?? 'Unknown';
  }

  private getTeamName(): string {
    return this.teams.find((t) => t.id === this.selectedTeamId)?.name ?? 'Unknown Team';
  }
}
