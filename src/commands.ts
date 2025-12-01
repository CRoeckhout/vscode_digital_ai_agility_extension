import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TicketsWebviewProvider } from './tickets/ticketsWebviewProvider';
import { createApi } from './agilityApi';
import { openTicketDetail } from './views/ticketView';
import {
  fetchStatuses,
  getStatusConfig,
  saveStatusConfig,
  getDevInProgressStatusId,
  getSelectedTeamId,
  mergeStatusConfig,
} from './statusService';
import { StatusConfig, StatusConfigMap } from './models/status';
import { colorPresets } from './constants/colors';

const execP = promisify(exec);

/**
 * Gets the closest emoji for a given hex color
 */
function getColorEmoji(hexColor: string): string {
    // Find exact match first
    const exactMatch = colorPresets.find((p) => p.color.toLowerCase() === hexColor.toLowerCase());
    if (exactMatch) {
        return exactMatch.emoji;
    }

    // Parse the hex color
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Find closest color by RGB distance
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

// Import the StatusTreeProvider type for the function signature
import type { StatusTreeProvider } from './views/statusTreeProvider';

export function registerCommands(
    context: vscode.ExtensionContext,
    myTicketsProvider: TicketsWebviewProvider,
    teamTicketsProvider: TicketsWebviewProvider,
    statusProvider: StatusTreeProvider
): void {
    // Helper: update a ticket's status and add selected user as owner via Agility REST endpoint
    async function updateTicketStatus(ticketId: string, statusId: string, assetType: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('agility');
        const instanceUrl = (config.get('instanceUrl') as string) || '';
        const token = (config.get('accessToken') as string) || '';

        if (!instanceUrl) {
            vscode.window.showWarningMessage('Agility instance URL not configured. Skipping status update.');
            return;
        }

        // Determine the correct endpoint based on asset type (Story or Defect)
        const endpoint = assetType === 'Defect' ? 'Defect' : 'Story';

        // Only POST to the Data API asset URL to update the ticket
        try {
            const api = await createApi(instanceUrl.replace(/\/$/, ''), token, context);

            // Get the selected member ID from the "My Tickets" view
            const selectedMemberId = myTicketsProvider.getSelectedMemberId();
            console.log('Selected Member ID:', selectedMemberId);

            // Build XML payload: update status and add selected user as owner
            let xml = `<Asset>
  <Relation name="Status" act="set">
    <Asset idref="StoryStatus:${statusId}" />
  </Relation>`;

            if (selectedMemberId) {
                // For multi-value relations, act="add" goes on the inner Asset element
                xml += `
  <Relation name="Owners">
    <Asset idref="Member:${selectedMemberId}" act="add" />
  </Relation>`;
            } else {
                console.log('No member selected in My Tickets view - owner will not be added');
            }

            xml += '\n</Asset>';
            console.log('XML payload:', xml);
            console.log('Endpoint:', `/Data/${endpoint}/${ticketId}`);

            await api.post(`/Data/${endpoint}/${ticketId}`, xml, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
            const ownerMsg = selectedMemberId ? ' and added you as owner' : '';
            vscode.window.showInformationMessage(`Ticket status updated${ownerMsg}.`);
            // Refresh the tickets list so the UI reflects the new status
            try { myTicketsProvider.refresh(); } catch { /* ignore if provider not available */ }
            try { teamTicketsProvider.refresh(); } catch { /* ignore if provider not available */ }
            return;
        } catch (err: unknown) {
            const axiosError = err as { response?: { data?: unknown; status?: number }; message?: string };
            const body = axiosError.response?.data;
            const status = axiosError.response?.status;
            console.error('Data API update error', { status, body, err });
            // If server complains with 400, try attribute-style payload as documented
            if (status === 400) {
                try {
                    const api2 = await createApi(instanceUrl.replace(/\/$/, ''), token, context);
                    const altXml = `<Asset>\n  <Attribute name="Status" act="set">StoryStatus:${statusId}</Attribute>\n</Asset>`;
                    await api2.post(`/Data/${endpoint}/${ticketId}`, altXml, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
                    vscode.window.showInformationMessage('Ticket status updated (Data API, attribute-style payload).');
                    // Refresh the tickets list so the UI reflects the new status
                    try { myTicketsProvider.refresh(); } catch { /* ignore if provider not available */ }
                    try { teamTicketsProvider.refresh(); } catch { /* ignore if provider not available */ }
                    return;
                } catch (err2: unknown) {
                    const axiosError2 = err2 as { response?: { data?: unknown; status?: number }; message?: string };
                    const body2 = axiosError2.response?.data;
                    const status2 = axiosError2.response?.status;
                    const msg2 = axiosError2.message ?? String(err2);
                    const details2 = body2 ? (typeof body2 === 'string' ? body2 : JSON.stringify(body2)) : msg2;
                    vscode.window.showErrorMessage(`Failed to update status via Data API (attribute fallback HTTP ${status2}): ${details2}`);
                    console.error('Data API attribute-fallback error', { status2, body2, err2 });
                    return;
                }
            }

            const msg = axiosError.message ?? String(err);
            const details = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : msg;
            vscode.window.showErrorMessage(`Failed to update status via Data API (HTTP ${status ?? 'n/a'}): ${details}`);
        }
    }

    // Refresh command for My Tickets view
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.refresh', () => {
            myTicketsProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.openInBrowser', (arg: unknown) => {
            let url: string | undefined;
            if (typeof arg === 'string') {
                url = arg;
            } else if (arg && typeof arg === 'object') {
                url = (arg as { url?: string }).url;
            }
            if (url) {
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        })
    );

    // Open ticket details inside a WebviewPanel
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.openTicket', async (arg: unknown) => {
            try {
                await openTicketDetail(context, arg);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Failed to open ticket: ${message}`);
            }
        })
    );

    // Create a git branch for a ticket. Expects the ticket node's url or an object with number and label.
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.createBranch', async (arg: any) => {
            // Check if Dev in Progress status is configured before proceeding
            let devInProgressId = getDevInProgressStatusId();
            if (!devInProgressId) {
                // Check if a team is selected
                const teamId = getSelectedTeamId();
                if (!teamId) {
                    const selectTeam = await vscode.window.showWarningMessage(
                        'Please select a team first to configure the Dev in Progress status.',
                        'Select Team',
                        'Skip'
                    );
                    if (selectTeam === 'Select Team') {
                        await vscode.commands.executeCommand('agility.changeTeam');
                        return;
                    } else if (selectTeam !== 'Skip') {
                        return;
                    }
                } else {
                    // Team is selected but no Dev in Progress status configured - prompt to select one
                    const configureNow = await vscode.window.showWarningMessage(
                        'No Dev in Progress status configured. Would you like to select one now?',
                        'Select Status',
                        'Skip'
                    );

                    if (configureNow === 'Select Status') {
                        try {
                            const statuses = await fetchStatuses(context, teamId);
                            if (statuses.length === 0) {
                                vscode.window.showWarningMessage('No statuses found for the selected team.');
                            } else {
                                const existingConfig = getStatusConfig();
                                const mergedConfig = mergeStatusConfig(existingConfig, statuses);

                                const statusItems = statuses.map((s) => ({
                                    label: s.name,
                                    statusId: s.id,
                                }));

                                const selected = await vscode.window.showQuickPick(statusItems, {
                                    placeHolder: 'Select the status to use as "Dev in Progress"',
                                });

                                if (selected) {
                                    // Update config with selected status as Dev in Progress
                                    const updatedConfig: StatusConfigMap = {};
                                    for (const [id, cfg] of Object.entries(mergedConfig)) {
                                        updatedConfig[id] = {
                                            ...cfg,
                                            isDevInProgress: id === selected.statusId,
                                        };
                                    }
                                    // Also add the selected status if not in config yet
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
                                    devInProgressId = selected.statusId;
                                    vscode.window.showInformationMessage(`"${selected.label}" is now the Dev in Progress status.`);
                                }
                            }
                        } catch (err: unknown) {
                            const message = err instanceof Error ? err.message : String(err);
                            vscode.window.showErrorMessage(`Failed to fetch statuses: ${message}`);
                        }
                    } else if (configureNow !== 'Skip') {
                        return;
                    }
                }
            }

            // arg may be the url string (from TreeItem.command arguments) or the TicketNode object
            let ticketNumber: string | undefined;
            let label: string | undefined;
            let assetId: string | undefined;
            let assetType: string = 'Story'; // Default to Story

            if (typeof arg === 'string') {
                // Try to extract ticket number and type from url, fallback to ask
                const m = arg.match(/\/(Story|Defect)?\/?(\d+)/i);
                if (m) {
                    assetType = m[1] || 'Story';
                    ticketNumber = m[2];
                }
            } else if (arg && typeof arg === 'object') {
                ticketNumber = arg.number || arg.id || undefined;
                label = arg.label || arg.name || undefined;
                assetId = (arg as any).assetId || undefined;
                assetType = (arg as any).assetType || 'Story';
                // sometimes TreeItem passes arguments array; handle that
                if (!ticketNumber && Array.isArray(arg)) {
                    ticketNumber = arg[0];
                }
            }

            // If we still don't have ticketNumber, prompt user
            if (!ticketNumber) {
                ticketNumber = await vscode.window.showInputBox({ prompt: 'Ticket number for branch name' });
                if (!ticketNumber) { return; }
            }

            if (!label) {
                // Ask user for the ticket title to generate nice branch name, allow default from clipboard or input
                label = await vscode.window.showInputBox({ prompt: 'Ticket title (used to create branch slug)' });
            }

            // Format branch name: <ticketNumber>/<slugified_label>
            const slugify = (s: string) => {
                let t = s.toLowerCase();
                // remove anything in brackets
                t = t.replace(/\[.*?\]/g, '');
                // remove leading ticket identifiers like S-12345, D-12345, s_12345, d_12345, 12345, or prefixes like "s 12345", "d 12345"
                t = t.replace(/^([sd][-_\s]?\d+\b)[:\-\s_]*/i, '');
                t = t.replace(/^(\d+\b)[:\-\s_]*/i, '');
                // normalize to underscores
                t = t.replace(/[^a-z0-9]+/g, '_');
                t = t.replace(/^_+|_+$/g, '');
                t = t.replace(/_+/g, '_');
                return t;
            };

            // Remove any occurrences of the ticket number (variants like S-12345, D-12345, s_12345, d_12345, or plain digits)
            let titleForSlug = label || '';
            if (ticketNumber) {
                const digits = ticketNumber.replace(/\D/g, '');
                if (digits) {
                    // remove variants like 'S-12345', 'D-12345', 's_12345', 'd_12345', '12345' anywhere in the title
                    titleForSlug = titleForSlug.replace(new RegExp(`([sd][-_\\s]?${digits}|${digits})`, 'ig'), '');
                }
            }

            const slug = titleForSlug ? slugify(titleForSlug) : 'ticket';
            const branchName = `${ticketNumber}/${slug}`;

            // Use VS Code Git extension API to create branch
            const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
            if (!gitExtension) {
                vscode.window.showErrorMessage('Git extension not found. Unable to create branch.');
                return;
            }
            const api = gitExtension.getAPI(1);
            if (!api.repositories || api.repositories.length === 0) {
                vscode.window.showErrorMessage('No git repositories found in workspace.');
                return;
            }

            // If multiple repos, ask user to pick
            let repo = api.repositories[0];
            if (api.repositories.length > 1) {
                const repoPaths: string[] = api.repositories.map((r: any) => r.rootUri.fsPath);
                const pick = await vscode.window.showQuickPick(repoPaths, { placeHolder: 'Select repository to create branch in' });
                if (!pick) { return; }
                repo = api.repositories.find((r: any) => r.rootUri.fsPath === pick)!;
            }

            try {
                // Check if branch already exists
                const existing = (repo.state.refs || []).find((r: any) => r.name === branchName);
                if (existing) {
                    const choice = await vscode.window.showQuickPick(['Switch to branch', 'Delete branch', 'Cancel'], { placeHolder: `Branch '${branchName}' already exists. What do you want to do?` });
                    if (!choice || choice === 'Cancel') { return; }

                    if (choice === 'Switch to branch') {
                        await repo.checkout(branchName);
                        vscode.window.showInformationMessage(`Switched to branch '${branchName}'`);
                        return;
                    }

                    if (choice === 'Delete branch') {
                        try {
                            await repo.deleteBranch(branchName, false);
                            vscode.window.showInformationMessage(`Deleted branch '${branchName}'. Creating new branch.`);
                        } catch (delErr: any) {
                            vscode.window.showErrorMessage(`Failed to delete branch '${branchName}': ${delErr?.message || delErr}`);
                            return;
                        }
                    }
                }

                // If repository has no commits (no HEAD), offer assisted actions
                const hasHead = !!(repo.state && repo.state.HEAD && repo.state.HEAD.commit);
                if (!hasHead) {
                    const choice = await vscode.window.showQuickPick(['Create initial commit', 'Create orphan branch', 'Cancel'], { placeHolder: `Repository has no commits. Choose how to proceed to create '${branchName}'.` });
                    if (!choice || choice === 'Cancel') { return; }

                    const cwd = repo.rootUri.fsPath;
                    try {
                        if (choice === 'Create initial commit') {
                            // Stage everything and create an initial commit
                            await execP('git add -A', { cwd });
                            await execP('git commit -m "chore: initial commit"', { cwd });
                            vscode.window.showInformationMessage('Created initial commit.');
                        } else if (choice === 'Create orphan branch') {
                            // Create orphan branch and make an initial empty commit
                            await execP(`git checkout --orphan ${branchName}`, { cwd });
                            // Remove all files from index to start clean
                            await execP('git reset --hard', { cwd });
                            await execP('git commit --allow-empty -m "Initial commit on orphan branch"', { cwd });
                            vscode.window.showInformationMessage(`Created orphan branch '${branchName}' and made initial commit.`);
                            return; // already on the new branch
                        }
                    } catch (gitErr: any) {
                        vscode.window.showErrorMessage(`Git operation failed: ${gitErr?.stderr || gitErr?.message || gitErr}`);
                        return;
                    }
                }

                // Create branch and checkout
                await repo.createBranch(branchName, true);
                vscode.window.showInformationMessage(`Created and checked out branch '${branchName}'`);
                // After creating the branch, attempt to update the ticket status to Dev in Progress
                try {
                    // Prefer the internal assetId (numeric internal ID) if available; fall back to digits parsed from the displayed ticket number
                    const ticketId = assetId || (ticketNumber || '').replace(/\D/g, '');
                    // Use the devInProgressId that was either pre-configured or just selected
                    if (ticketId && devInProgressId) {
                        await updateTicketStatus(ticketId, devInProgressId, assetType);
                    }
                } catch (updErr: any) {
                    // Don't block branch creation if status update fails
                    vscode.window.showErrorMessage(`Failed to update ticket status: ${updErr?.message || updErr}`);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to create branch '${branchName}': ${err?.message || err}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility-helper.configure', async () => {
            const config = vscode.workspace.getConfiguration('agility');

            const url = await vscode.window.showInputBox({
                title: 'Agility Instance URL',
                placeHolder: 'https://www12.v1host.com/YourCompany',
                ignoreFocusOut: true,
                value: config.get('instanceUrl') as string
            });
            if (url !== undefined) {
                await config.update('instanceUrl', url?.trim(), true);
            }

            const token = await vscode.window.showInputBox({
                title: 'Personal Access Token',
                password: true,
                ignoreFocusOut: true,
                placeHolder: 'pat:...'
            });
            if (token !== undefined) {
                await config.update('accessToken', token?.trim(), true);
            }

            if (url ?? token) {
                vscode.window.showInformationMessage('Agility configured! Refresh tickets to load.');
                myTicketsProvider.refresh();
                teamTicketsProvider.refresh();
            }
        })
    );

    // My Tickets commands
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.changeMember', () => {
            myTicketsProvider.changeMember();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.clearMember', () => {
            myTicketsProvider.clearMember();
        })
    );

    // Team commands
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.changeTeam', () => {
            teamTicketsProvider.changeTeam();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.clearTeam', () => {
            teamTicketsProvider.clearTeam();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility-team.refresh', () => {
            teamTicketsProvider.refresh();
        })
    );

    // Status configuration commands
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.configureStatusColors', async () => {
            try {
                // Check if a team is selected
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

                // Fetch current statuses from Agility filtered by team
                const statuses = await fetchStatuses(context, teamId);

                if (statuses.length === 0) {
                    vscode.window.showWarningMessage('No statuses found for the selected team. Please check your configuration.');
                    return;
                }

                // Get or create status config
                const existingConfig = getStatusConfig();
                const mergedConfig = mergeStatusConfig(existingConfig, statuses);

                // Save merged config (ensures all statuses are in settings)
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

                await configureStatus(selected.statusConfig, mergedConfig, myTicketsProvider, teamTicketsProvider, statusProvider);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Failed to configure statuses: ${message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.setDevInProgressStatus', async () => {
            try {
                // Check if a team is selected
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

                // Fetch current statuses from Agility filtered by team
                const statuses = await fetchStatuses(context, teamId);

                if (statuses.length === 0) {
                    vscode.window.showWarningMessage('No statuses found for the selected team. Please check your configuration.');
                    return;
                }

                // Get or create status config
                const existingConfig = getStatusConfig();
                const mergedConfig = mergeStatusConfig(existingConfig, statuses);

                // Let user select a status to mark as Dev in Progress (only show statuses for this team)
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

                // Refresh views to reflect any changes
                myTicketsProvider.refresh();
                teamTicketsProvider.refresh();
                statusProvider.refresh();
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Failed to set Dev in Progress status: ${message}`);
            }
        })
    );

    // Status view commands
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.status.refresh', () => {
            statusProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.status.setDevInProgress', async (item: unknown) => {
            if (item && typeof item === 'object' && 'statusConfig' in item) {
                await statusProvider.setDevInProgress(item as any);
                myTicketsProvider.refresh();
                teamTicketsProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.status.clearDevInProgress', async (item: unknown) => {
            if (item && typeof item === 'object' && 'statusConfig' in item) {
                await statusProvider.clearDevInProgress(item as any);
                myTicketsProvider.refresh();
                teamTicketsProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.status.changeColor', async (item: unknown) => {
            if (item && typeof item === 'object' && 'statusConfig' in item) {
                await statusProvider.changeColor(item as any);
                myTicketsProvider.refresh();
                teamTicketsProvider.refresh();
            }
        })
    );
}

/**
 * Helper function to configure a single status (color and Dev in Progress flag)
 */
async function configureStatus(
    statusConfig: StatusConfig,
    allConfig: StatusConfigMap,
    myTicketsProvider: TicketsWebviewProvider,
    teamTicketsProvider: TicketsWebviewProvider,
    statusProvider: StatusTreeProvider
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
        // Show color picker with presets and custom option
        const selectedColor = await showColorPicker(statusConfig.name, statusConfig.color);

        if (!selectedColor) {
            return;
        }

        // Update config with new color
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
        // Toggle Dev in Progress status
        const newIsDevInProgress = !statusConfig.isDevInProgress;

        // If marking as Dev in Progress, clear others first
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

    // Refresh views
    myTicketsProvider.refresh();
    teamTicketsProvider.refresh();
    statusProvider.refresh();
}

/**
 * Shows a color picker with preset colors and a custom color option
 */
async function showColorPicker(statusName: string, currentColor: string): Promise<string | undefined> {
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
        // Show input box for custom color
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
