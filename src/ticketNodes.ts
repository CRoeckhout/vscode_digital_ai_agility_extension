import * as vscode from 'vscode';

export class TicketNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly number: string,
        public readonly status: string,
        public readonly project: string,
        public readonly url: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${number} 		 ${status} 		 ${project}`;
        this.description = `${status} 		 ${project}`;
        this.contextValue = 'ticket';
        this.iconPath = new vscode.ThemeIcon('ticket');

        this.command = {
            command: 'agility.openInBrowser',
            title: 'Open in Agility',
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
