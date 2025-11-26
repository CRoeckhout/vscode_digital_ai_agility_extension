import * as vscode from 'vscode';
import * as path from 'path';

export class TicketNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly number: string,
        public readonly assetId: string,
        public readonly status: string,
        public readonly project: string,
        public readonly url: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${number} 		 ${status} 		 ${project}`;
        this.description = `${status} 		 ${project}`;
        this.contextValue = 'ticket';
        // Use specific SVG icons when the ticket label starts with 'S' (story) or 'D' (defect).
        // Fallback to the default 'ticket' theme icon otherwise.
        const firstChar = (label && label.length) ? label.charAt(0).toUpperCase() : '';
        if (firstChar === 'S') {
            this.iconPath = vscode.Uri.file(path.join(__dirname, '..', '..', 'images', 'story-icon.svg'));
        } else if (firstChar === 'D') {
            this.iconPath = vscode.Uri.file(path.join(__dirname, '..', '..', 'images', 'defect-icon.svg'));
        } else {
            this.iconPath = new vscode.ThemeIcon('ticket');
        }

        // Default action when clicking a ticket: open the extension's ticket detail view
        // (registered under the command 'agility.openTicket').
        this.command = {
            command: 'agility.openTicket',
            title: 'Open ticket details',
            arguments: [this]
        };
    }
}

export class StatusNode extends vscode.TreeItem {
    constructor(
        public readonly status: string,
        public readonly color: string,
        public readonly tickets: TicketNode[]
    ) {
        super(`${status} (${tickets.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = `${tickets.length} ticket(s) 		 ${status}`;
        this.contextValue = 'status';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="6" fill="${color}"/></svg>`;
        this.iconPath = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
    }
}
