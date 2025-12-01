import * as vscode from 'vscode';
import { fetchStatuses, mergeStatusConfig } from '../api/statusService';
import { getStatusConfig, saveStatusConfig, getSelectedTeamId } from '../config';
import { StatusConfig, StatusConfigMap } from '../models/status';
import { getColorEmoji, showColorPicker } from '../utils';

/**
 * TreeItem representing a status in the Status view
 */
class StatusTreeItem extends vscode.TreeItem {
  constructor(
    public readonly statusConfig: StatusConfig,
    public readonly isDevInProgress: boolean
  ) {
    super(statusConfig.name, vscode.TreeItemCollapsibleState.None);

    const isHidden = statusConfig.hidden ?? false;
    const emoji = getColorEmoji(statusConfig.color);
    const starIcon = isDevInProgress ? ' ⭐' : '';
    const hiddenIcon = isHidden ? ' 👁️‍🗨️' : '';
    this.label = `${emoji} ${statusConfig.name}${starIcon}${hiddenIcon}`;
    this.description = isHidden ? '(hidden)' : statusConfig.color;
    this.tooltip = new vscode.MarkdownString(
      `**${statusConfig.name}**\n\n` +
        `Color: \`${statusConfig.color}\`\n\n` +
        (isDevInProgress ? '⭐ This status is used when creating branches\n\n' : '') +
        (isHidden ? '👁️‍🗨️ This status is hidden in ticket views' : '')
    );

    // Build context value for menu visibility
    let ctxValue = 'status';
    if (isDevInProgress) {
      ctxValue += '-devInProgress';
    }
    if (isHidden) {
      ctxValue += '-hidden';
    }
    this.contextValue = ctxValue;

    // Store the status config for commands
    this.command = undefined;
  }
}

/**
 * Message item shown when no team is selected or for error/info messages
 */
class MessageTreeItem extends vscode.TreeItem {
  constructor(message: string, command?: vscode.Command) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'message';
    this.command = command;
  }
}

/**
 * TreeDataProvider for the Status configuration view
 */
export class StatusTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private statusConfigs: StatusConfigMap = {};
  private loading = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('agility.selectedTeam') ||
        e.affectsConfiguration('agility.statusConfig')
      ) {
        this.refresh();
      }
    });
  }

  refresh(): void {
    this.statusConfigs = {};
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const teamId = getSelectedTeamId();
    if (!teamId) {
      return [
        new MessageTreeItem('$(info) Select a team first', {
          title: 'Select Team',
          command: 'agility.changeTeam',
        }),
      ];
    }

    if (this.loading) {
      return [new MessageTreeItem('$(loading~spin) Loading statuses...')];
    }

    try {
      this.loading = true;

      const statuses = await fetchStatuses(this.context, teamId);
      if (statuses.length === 0) {
        this.loading = false;
        return [new MessageTreeItem('$(warning) No statuses found for this team')];
      }

      const existingConfig = getStatusConfig();
      this.statusConfigs = mergeStatusConfig(existingConfig, statuses);

      // Save merged config
      await saveStatusConfig(this.statusConfigs);

      this.loading = false;

      // Map statuses to tree items
      return statuses.map((status) => {
        const cfg = this.statusConfigs[status.id];
        if (!cfg) {
          return new StatusTreeItem(
            { id: status.id, name: status.name, color: '#1f77b4', order: status.order, isDevInProgress: false },
            false
          );
        }
        return new StatusTreeItem(cfg, cfg.isDevInProgress ?? false);
      });
    } catch (err: unknown) {
      this.loading = false;
      const message = err instanceof Error ? err.message : String(err);
      return [new MessageTreeItem(`$(error) ${message}`)];
    }
  }

  /**
   * Set a status as the Dev in Progress status
   */
  async setDevInProgress(item: StatusTreeItem): Promise<void> {
    const updatedConfig: StatusConfigMap = {};

    for (const [id, cfg] of Object.entries(this.statusConfigs)) {
      updatedConfig[id] = {
        ...cfg,
        isDevInProgress: id === item.statusConfig.id,
      };
    }

    await saveStatusConfig(updatedConfig);
    vscode.window.showInformationMessage(
      `"${item.statusConfig.name}" is now the Dev in Progress status.`
    );
    this.refresh();
  }

  /**
   * Clear the Dev in Progress flag from a status
   */
  async clearDevInProgress(item: StatusTreeItem): Promise<void> {
    const updatedConfig: StatusConfigMap = {};

    for (const [id, cfg] of Object.entries(this.statusConfigs)) {
      updatedConfig[id] = {
        ...cfg,
        isDevInProgress: id === item.statusConfig.id ? false : cfg.isDevInProgress,
      };
    }

    await saveStatusConfig(updatedConfig);
    vscode.window.showInformationMessage(
      `"${item.statusConfig.name}" is no longer the Dev in Progress status.`
    );
    this.refresh();
  }

  /**
   * Toggle visibility of a status in ticket views
   */
  async toggleVisibility(item: StatusTreeItem): Promise<void> {
    const isCurrentlyHidden = item.statusConfig.hidden ?? false;
    const updatedConfig: StatusConfigMap = {
      ...this.statusConfigs,
      [item.statusConfig.id]: {
        ...item.statusConfig,
        hidden: !isCurrentlyHidden,
      },
    };

    await saveStatusConfig(updatedConfig);
    const action = isCurrentlyHidden ? 'visible' : 'hidden';
    vscode.window.showInformationMessage(
      `"${item.statusConfig.name}" is now ${action} in ticket views.`
    );
    this.refresh();
  }

  /**
   * Change the color of a status
   */
  async changeColor(item: StatusTreeItem): Promise<void> {
    const selectedColor = await showColorPicker(
      item.statusConfig.name,
      item.statusConfig.color
    );

    if (!selectedColor) {
      return;
    }

    const updatedConfig: StatusConfigMap = {
      ...this.statusConfigs,
      [item.statusConfig.id]: {
        ...item.statusConfig,
        color: selectedColor,
      },
    };

    await saveStatusConfig(updatedConfig);
    vscode.window.showInformationMessage(
      `Color for "${item.statusConfig.name}" updated to ${selectedColor}`
    );
    this.refresh();
  }
}
