import * as vscode from 'vscode';

export class TicketNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly number: string,
    public readonly status: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly url?: string
  ) {
    super(label, collapsibleState);
    this.tooltip = `${number} – ${status}`;
    this.description = status;
    this.contextValue = 'ticket';           // enables right-click & inline menu
    this.iconPath = new vscode.ThemeIcon('issues');

    // Click to open in browser later
    if (url) {
      this.command = {
        command: 'agility.openInBrowser',
        title: 'Open in Agility',
        arguments: [url]
      };
    }
  }
}

export class AgilityTicketProvider implements vscode.TreeDataProvider<TicketNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TicketNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Fake data for now – replace later with real API result
  private tickets: TicketNode[] = [
    new TicketNode('S-01234: Fix login bug', 'S-01234', 'In Progress', vscode.TreeItemCollapsibleState.None, 'https://yourcompany.v1host.com/assetDetail.v1?oid=Story:123456'),
    new TicketNode('D-05678: Update documentation', 'D-05678', 'To Do', vscode.TreeItemCollapsibleState.None),
    new TicketNode('S-09876: Add dark mode', 'S-09876', 'Done', vscode.TreeItemCollapsibleState.None),
  ];

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }

  getTreeItem(element: TicketNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TicketNode): Thenable<TicketNode[]> {
    if (!element) {
      return Promise.resolve(this.tickets);
    }
    return Promise.resolve([]);
  }

  // Optional: group by status later
  // getChildren(element?: TicketNode): Thenable<TicketNode[] | vscode.TreeItem[]> { ... }
}