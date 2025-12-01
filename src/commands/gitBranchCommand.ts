/**
 * Git branch creation command for Agility tickets.
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { generateBranchName } from '../utils';
import { getDevInProgressStatusId, getSelectedTeamId, getStatusConfig, saveStatusConfig } from '../config';
import { fetchStatuses, mergeStatusConfig, updateTicketStatus } from '../api';
import { getErrorMessage, GitError } from '../errors';
import { StatusConfigMap } from '../models';

const execP = promisify(exec);

/**
 * Arguments passed to the createBranch command.
 */
interface CreateBranchArg {
  number?: string;
  id?: string;
  label?: string;
  name?: string;
  url?: string;
  assetId?: string;
  assetType?: string;
}

/**
 * Registers the git branch creation command.
 */
export function registerGitBranchCommand(
  context: vscode.ExtensionContext,
  getSelectedMemberId: () => string | null,
  refreshViews: () => void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('agility.createBranch', async (arg: unknown) => {
      try {
        await handleCreateBranch(context, arg, getSelectedMemberId, refreshViews);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create branch: ${getErrorMessage(error)}`);
      }
    })
  );
}

/**
 * Main handler for branch creation.
 */
async function handleCreateBranch(
  context: vscode.ExtensionContext,
  arg: unknown,
  getSelectedMemberId: () => string | null,
  refreshViews: () => void
): Promise<void> {
  // Ensure Dev in Progress status is configured
  let devInProgressId = await ensureDevInProgressStatus(context);

  // Parse the argument to extract ticket info
  const ticketInfo = parseTicketArg(arg);
  
  // Get ticket number if not provided
  let { ticketNumber, label, assetId, assetType } = ticketInfo;

  if (!ticketNumber) {
    ticketNumber = await vscode.window.showInputBox({ prompt: 'Ticket number for branch name' });
    if (!ticketNumber) {
      return;
    }
  }

  if (!label) {
    label = await vscode.window.showInputBox({ prompt: 'Ticket title (used to create branch slug)' });
  }

  // Generate branch name
  const branchName = generateBranchName(ticketNumber, label);

  // Get Git repository
  const repo = await getGitRepository();
  if (!repo) {
    return;
  }

  // Check if branch already exists
  const existingBranch = (repo.state.refs || []).find(
    (r: { name?: string }) => r.name === branchName
  );

  if (existingBranch) {
    const handled = await handleExistingBranch(repo, branchName);
    if (!handled) {
      return;
    }
  }

  // Handle repository with no commits
  const hasHead = Boolean(repo.state?.HEAD?.commit);
  if (!hasHead) {
    const handled = await handleNoCommits(repo, branchName);
    if (!handled) {
      return;
    }
    // If orphan branch was created, we're done
    return;
  }

  // Create and checkout branch
  await repo.createBranch(branchName, true);
  vscode.window.showInformationMessage(`Created and checked out branch '${branchName}'`);

  // Update ticket status to Dev in Progress
  if (devInProgressId) {
    const ticketId = assetId || ticketNumber.replace(/\D/g, '');
    if (ticketId) {
      try {
        await updateTicketStatus(
          context,
          ticketId,
          devInProgressId,
          assetType,
          getSelectedMemberId()
        );
        const ownerMsg = getSelectedMemberId() ? ' and added you as owner' : '';
        vscode.window.showInformationMessage(`Ticket status updated${ownerMsg}.`);
        refreshViews();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to update ticket status: ${getErrorMessage(error)}`);
      }
    }
  }
}

/**
 * Ensures a Dev in Progress status is configured.
 * Prompts the user to select one if not configured.
 */
async function ensureDevInProgressStatus(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  let devInProgressId = getDevInProgressStatusId();
  
  if (devInProgressId) {
    return devInProgressId;
  }

  const teamId = getSelectedTeamId();
  
  if (!teamId) {
    const selectTeam = await vscode.window.showWarningMessage(
      'Please select a team first to configure the Dev in Progress status.',
      'Select Team',
      'Skip'
    );
    if (selectTeam === 'Select Team') {
      await vscode.commands.executeCommand('agility.changeTeam');
    }
    return undefined;
  }

  const configureNow = await vscode.window.showWarningMessage(
    'No Dev in Progress status configured. Would you like to select one now?',
    'Select Status',
    'Skip'
  );

  if (configureNow !== 'Select Status') {
    return undefined;
  }

  try {
    const statuses = await fetchStatuses(context, teamId);
    if (statuses.length === 0) {
      vscode.window.showWarningMessage('No statuses found for the selected team.');
      return undefined;
    }

    const existingConfig = getStatusConfig();
    const mergedConfig = mergeStatusConfig(existingConfig, statuses);

    const statusItems = statuses.map((s) => ({
      label: s.name,
      statusId: s.id,
    }));

    const selected = await vscode.window.showQuickPick(statusItems, {
      placeHolder: 'Select the status to use as "Dev in Progress"',
    });

    if (!selected) {
      return undefined;
    }

    // Update config with selected status as Dev in Progress
    const updatedConfig: StatusConfigMap = {};
    for (const [id, cfg] of Object.entries(mergedConfig)) {
      updatedConfig[id] = {
        ...cfg,
        isDevInProgress: id === selected.statusId,
      };
    }

    // Add the selected status if not in config yet
    if (!updatedConfig[selected.statusId]) {
      const statusInfo = statuses.find((s) => s.id === selected.statusId);
      if (statusInfo) {
        updatedConfig[selected.statusId] = {
          id: selected.statusId,
          name: statusInfo.name,
          color: '#1f77b4',
          order: statusInfo.order,
          isDevInProgress: true,
        };
      }
    }

    await saveStatusConfig(updatedConfig);
    vscode.window.showInformationMessage(`"${selected.label}" is now the Dev in Progress status.`);
    
    return selected.statusId;
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to fetch statuses: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/**
 * Parses the command argument to extract ticket information.
 */
function parseTicketArg(arg: unknown): {
  ticketNumber: string | undefined;
  label: string | undefined;
  assetId: string | undefined;
  assetType: string;
} {
  let ticketNumber: string | undefined;
  let label: string | undefined;
  let assetId: string | undefined;
  let assetType = 'Story';

  if (typeof arg === 'string') {
    const match = arg.match(/\/(Story|Defect)?\/?(\d+)/i);
    if (match) {
      assetType = match[1] || 'Story';
      ticketNumber = match[2];
    }
  } else if (arg && typeof arg === 'object') {
    const objArg = arg as CreateBranchArg;
    ticketNumber = objArg.number || objArg.id;
    label = objArg.label || objArg.name;
    assetId = objArg.assetId;
    assetType = objArg.assetType || 'Story';

    // Handle array argument (TreeItem passes arguments array)
    if (!ticketNumber && Array.isArray(arg)) {
      ticketNumber = (arg as string[])[0];
    }
  }

  return { ticketNumber, label, assetId, assetType };
}

/**
 * Gets the Git repository to use for branch creation.
 */
async function getGitRepository(): Promise<{
  rootUri: { fsPath: string };
  state: { refs?: Array<{ name?: string }>; HEAD?: { commit?: string } };
  checkout: (name: string) => Promise<void>;
  createBranch: (name: string, checkout: boolean) => Promise<void>;
  deleteBranch: (name: string, force: boolean) => Promise<void>;
} | null> {
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
  
  if (!gitExtension) {
    vscode.window.showErrorMessage('Git extension not found. Unable to create branch.');
    return null;
  }

  const api = gitExtension.getAPI(1);
  
  if (!api.repositories || api.repositories.length === 0) {
    vscode.window.showErrorMessage('No git repositories found in workspace.');
    return null;
  }

  let repo = api.repositories[0];

  // If multiple repos, ask user to pick
  if (api.repositories.length > 1) {
    const repoPaths: string[] = api.repositories.map(
      (r: { rootUri: { fsPath: string } }) => r.rootUri.fsPath
    );
    const pick = await vscode.window.showQuickPick(repoPaths, {
      placeHolder: 'Select repository to create branch in',
    });
    if (!pick) {
      return null;
    }
    repo = api.repositories.find(
      (r: { rootUri: { fsPath: string } }) => r.rootUri.fsPath === pick
    );
  }

  return repo;
}

/**
 * Handles the case when the branch already exists.
 * Returns true if branch creation should continue, false otherwise.
 */
async function handleExistingBranch(
  repo: { checkout: (name: string) => Promise<void>; deleteBranch: (name: string, force: boolean) => Promise<void> },
  branchName: string
): Promise<boolean> {
  const choice = await vscode.window.showQuickPick(
    ['Switch to branch', 'Delete branch', 'Cancel'],
    { placeHolder: `Branch '${branchName}' already exists. What do you want to do?` }
  );

  if (!choice || choice === 'Cancel') {
    return false;
  }

  if (choice === 'Switch to branch') {
    await repo.checkout(branchName);
    vscode.window.showInformationMessage(`Switched to branch '${branchName}'`);
    return false;
  }

  if (choice === 'Delete branch') {
    try {
      await repo.deleteBranch(branchName, false);
      vscode.window.showInformationMessage(`Deleted branch '${branchName}'. Creating new branch.`);
      return true;
    } catch (error) {
      throw new GitError(`Failed to delete branch '${branchName}': ${getErrorMessage(error)}`, error);
    }
  }

  return false;
}

/**
 * Handles the case when the repository has no commits.
 * Returns true if normal branch creation should continue, false otherwise.
 */
async function handleNoCommits(
  repo: { rootUri: { fsPath: string } },
  branchName: string
): Promise<boolean> {
  const choice = await vscode.window.showQuickPick(
    ['Create initial commit', 'Create orphan branch', 'Cancel'],
    { placeHolder: `Repository has no commits. Choose how to proceed to create '${branchName}'.` }
  );

  if (!choice || choice === 'Cancel') {
    return false;
  }

  const cwd = repo.rootUri.fsPath;

  try {
    if (choice === 'Create initial commit') {
      await execP('git add -A', { cwd });
      await execP('git commit -m "chore: initial commit"', { cwd });
      vscode.window.showInformationMessage('Created initial commit.');
      return true;
    }

    if (choice === 'Create orphan branch') {
      await execP(`git checkout --orphan ${branchName}`, { cwd });
      await execP('git reset --hard', { cwd });
      await execP('git commit --allow-empty -m "Initial commit on orphan branch"', { cwd });
      vscode.window.showInformationMessage(`Created orphan branch '${branchName}' and made initial commit.`);
      return false;
    }
  } catch (error) {
    const execError = error as { stderr?: string; message?: string };
    throw new GitError(
      `Git operation failed: ${execError.stderr || execError.message || String(error)}`,
      error
    );
  }

  return false;
}
