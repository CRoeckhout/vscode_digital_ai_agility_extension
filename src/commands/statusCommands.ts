/**
 * Status-related commands for the Agility extension.
 */

import * as vscode from 'vscode';
import { getSelectedTeamId, getStatusConfig, saveStatusConfig } from '../config';
import { fetchStatuses, mergeStatusConfig } from '../api';
import { getColorEmoji, showColorPicker } from '../utils';
import { getErrorMessage } from '../errors';
import { StatusConfig, StatusConfigMap } from '../models';

/**
 * Callback type for refreshing views.
 */
type RefreshCallback = () => void;

/**
 * Registers all status-related commands.
 */
export function registerStatusCommands(
  context: vscode.ExtensionContext,
  refreshViews: RefreshCallback
): void {
  // Configure status colors
  context.subscriptions.push(
    vscode.commands.registerCommand('agility.configureStatusColors', async () => {
      await handleConfigureStatusColors(context, refreshViews);
    })
  );

  // Set Dev in Progress status
  context.subscriptions.push(
    vscode.commands.registerCommand('agility.setDevInProgressStatus', async () => {
      await handleSetDevInProgressStatus(context, refreshViews);
    })
  );
}

/**
 * Handles the configure status colors command.
 */
async function handleConfigureStatusColors(
  context: vscode.ExtensionContext,
  refreshViews: RefreshCallback
): Promise<void> {
  try {
    const teamId = getSelectedTeamId();
    
    if (!teamId) {
      const selectTeam = await vscode.window.showWarningMessage(
        'Please select a team first. Statuses are team-specific.',
        'Select Team'
      );
      if (selectTeam === 'Select Team') {
        await vscode.commands.executeCommand('agility.changeTeam');
      }
      return;
    }

    const statuses = await fetchStatuses(context, teamId);

    if (statuses.length === 0) {
      vscode.window.showWarningMessage('No statuses found for the selected team. Please check your configuration.');
      return;
    }

    const existingConfig = getStatusConfig();
    const mergedConfig = mergeStatusConfig(existingConfig, statuses);

    await saveStatusConfig(mergedConfig);

    // Let user select a status to configure
    const statusItems = Object.values(mergedConfig)
      .filter((cfg) => statuses.some((s) => s.id === cfg.id))
      .map((cfg) => ({
        label: `${getColorEmoji(cfg.color)} ${cfg.name}`,
        description: cfg.isDevInProgress ? '$(debug-start) Dev in Progress' : '',
        detail: `Color: ${cfg.color}`,
        statusConfig: cfg,
      }));

    const selected = await vscode.window.showQuickPick(statusItems, {
      placeHolder: 'Select a status to configure its color or mark as Dev in Progress',
    });

    if (!selected) {
      return;
    }

    await configureStatus(selected.statusConfig, mergedConfig, refreshViews);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to configure statuses: ${getErrorMessage(error)}`);
  }
}

/**
 * Handles the set Dev in Progress status command.
 */
async function handleSetDevInProgressStatus(
  context: vscode.ExtensionContext,
  refreshViews: RefreshCallback
): Promise<void> {
  try {
    const teamId = getSelectedTeamId();
    
    if (!teamId) {
      const selectTeam = await vscode.window.showWarningMessage(
        'Please select a team first. Statuses are team-specific.',
        'Select Team'
      );
      if (selectTeam === 'Select Team') {
        await vscode.commands.executeCommand('agility.changeTeam');
      }
      return;
    }

    const statuses = await fetchStatuses(context, teamId);

    if (statuses.length === 0) {
      vscode.window.showWarningMessage('No statuses found for the selected team. Please check your configuration.');
      return;
    }

    const existingConfig = getStatusConfig();
    const mergedConfig = mergeStatusConfig(existingConfig, statuses);

    // Let user select a status to mark as Dev in Progress
    const statusItems = Object.values(mergedConfig)
      .filter((cfg) => statuses.some((s) => s.id === cfg.id))
      .map((cfg) => ({
        label: `${getColorEmoji(cfg.color)} ${cfg.name}`,
        description: cfg.isDevInProgress ? '$(check) Currently selected' : '',
        statusConfig: cfg,
      }));

    const selected = await vscode.window.showQuickPick(statusItems, {
      placeHolder: 'Select the status to use when creating a branch (Dev in Progress)',
    });

    if (!selected) {
      return;
    }

    // Update the config: clear previous Dev in Progress, set new one
    const updatedConfig: StatusConfigMap = {};
    for (const [id, cfg] of Object.entries(mergedConfig)) {
      updatedConfig[id] = {
        ...cfg,
        isDevInProgress: id === selected.statusConfig.id,
      };
    }

    await saveStatusConfig(updatedConfig);
    vscode.window.showInformationMessage(`"${selected.label}" is now the Dev in Progress status.`);

    refreshViews();
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to set Dev in Progress status: ${getErrorMessage(error)}`);
  }
}

/**
 * Configures a single status (color and Dev in Progress flag).
 */
async function configureStatus(
  statusConfig: StatusConfig,
  allConfig: StatusConfigMap,
  refreshViews: RefreshCallback
): Promise<void> {
  const actions = [
    { label: '$(paintcan) Change Color', action: 'color' as const },
    {
      label: statusConfig.isDevInProgress
        ? '$(debug-stop) Unmark as Dev in Progress'
        : '$(debug-start) Mark as Dev in Progress',
      action: 'devInProgress' as const,
    },
  ];

  const selectedAction = await vscode.window.showQuickPick(actions, {
    placeHolder: `Configure "${statusConfig.name}"`,
  });

  if (!selectedAction) {
    return;
  }

  if (selectedAction.action === 'color') {
    const selectedColor = await showColorPicker(statusConfig.name, statusConfig.color);

    if (!selectedColor) {
      return;
    }

    const updatedConfig: StatusConfigMap = {
      ...allConfig,
      [statusConfig.id]: {
        ...statusConfig,
        color: selectedColor,
      },
    };

    await saveStatusConfig(updatedConfig);
    vscode.window.showInformationMessage(`Color for "${statusConfig.name}" updated to ${selectedColor}`);
  } else if (selectedAction.action === 'devInProgress') {
    const newIsDevInProgress = !statusConfig.isDevInProgress;

    const updatedConfig: StatusConfigMap = {};
    for (const [id, cfg] of Object.entries(allConfig)) {
      if (id === statusConfig.id) {
        updatedConfig[id] = { ...cfg, isDevInProgress: newIsDevInProgress };
      } else {
        updatedConfig[id] = { ...cfg, isDevInProgress: newIsDevInProgress ? false : cfg.isDevInProgress };
      }
    }

    await saveStatusConfig(updatedConfig);

    if (newIsDevInProgress) {
      vscode.window.showInformationMessage(`"${statusConfig.name}" is now the Dev in Progress status.`);
    } else {
      vscode.window.showInformationMessage(`"${statusConfig.name}" is no longer the Dev in Progress status.`);
    }
  }

  refreshViews();
}
