import * as vscode from 'vscode';
import {
  fetchStatuses,
  getStatusConfig,
  saveStatusConfig,
  getSelectedTeamId,
  mergeStatusConfig,
} from '../statusService';
import { StatusConfig, StatusConfigMap } from '../models/status';
import { colorPresets } from '../constants/colors';

/**
 * Gets the closest emoji for a given hex color
 */
function getColorEmoji(hexColor: string): string {
  const exactMatch = colorPresets.find(
    (p) => p.color.toLowerCase() === hexColor.toLowerCase()
  );
  if (exactMatch) {
    return exactMatch.emoji;
  }

  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  let closestPreset = colorPresets[0];
  let minDistance = Infinity;

  for (const preset of colorPresets) {
    const pHex = preset.color.replace('#', '');
    const pR = parseInt(pHex.substring(0, 2), 16);
    const pG = parseInt(pHex.substring(2, 4), 16);
    const pB = parseInt(pHex.substring(4, 6), 16);

    const distance = Math.sqrt(
      Math.pow(r - pR, 2) + Math.pow(g - pG, 2) + Math.pow(b - pB, 2)
    );

    if (distance < minDistance) {
      minDistance = distance;
      closestPreset = preset;
    }
  }

  return closestPreset.emoji;
}

/**
 * TreeItem representing a status in the Status view
 */
class StatusTreeItem extends vscode.TreeItem {
  constructor(
    public readonly statusConfig: StatusConfig,
    public readonly isDevInProgress: boolean
  ) {
    super(statusConfig.name, vscode.TreeItemCollapsibleState.None);

    const emoji = getColorEmoji(statusConfig.color);
    const starIcon = isDevInProgress ? ' ⭐' : '';
    this.label = `${emoji} ${statusConfig.name}${starIcon}`;
    this.description = statusConfig.color;
    this.tooltip = new vscode.MarkdownString(
      `**${statusConfig.name}**\n\n` +
      `Color: \`${statusConfig.color}\`\n\n` +
      (isDevInProgress ? '⭐ This status is used when creating branches' : '')
    );
    this.contextValue = isDevInProgress ? 'status-devInProgress' : 'status';

    // Store the status config for commands
    this.command = undefined;
  }
}

/**
 * Message item shown when no team is selected
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

      // Filter to only show statuses for the current team
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
   * Change the color of a status
   */
  async changeColor(item: StatusTreeItem): Promise<void> {
    const selectedColor = await this.showColorPicker(
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

  /**
   * Shows a color picker with preset colors and a custom color option
   */
  private async showColorPicker(
    statusName: string,
    currentColor: string
  ): Promise<string | undefined> {
    interface ColorPickerItem extends vscode.QuickPickItem {
      color?: string;
      isCustom?: boolean;
    }

    const items: ColorPickerItem[] = [
      {
        label: '$(edit) Custom Color...',
        description: 'Enter a hex color code',
        isCustom: true,
      },
      {
        label: '',
        kind: vscode.QuickPickItemKind.Separator,
      },
      ...colorPresets.map((preset) => ({
        label: `${preset.emoji} ${preset.name}`,
        description: preset.color,
        detail: preset.color === currentColor ? '$(check) Current' : undefined,
        color: preset.color,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select a color for "${statusName}"`,
      title: `Current color: ${currentColor}`,
    });

    if (!selected) {
      return undefined;
    }

    if (selected.isCustom) {
      const colorInput = await vscode.window.showInputBox({
        title: `Set custom color for "${statusName}"`,
        prompt: 'Enter a hex color (e.g., #1f77b4)',
        value: currentColor,
        validateInput: (value) => {
          const hexPattern = /^#[0-9A-Fa-f]{6}$/;
          if (!hexPattern.test(value)) {
            return 'Please enter a valid hex color (e.g., #1f77b4)';
          }
          return null;
        },
      });
      return colorInput;
    }

    return selected.color;
  }
}
