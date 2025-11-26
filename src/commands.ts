import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
const execP = promisify(exec);
import { AgilityTicketProvider } from './ticketProvider';

export function registerCommands(context: vscode.ExtensionContext, provider: AgilityTicketProvider) {
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.refresh', () => {
            provider['tickets'] = [];
            provider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.openInBrowser', (arg: any) => {
            let url: string | undefined;
            if (typeof arg === 'string') { url = arg; }
            else if (arg && typeof arg === 'object') { url = (arg as any).url; }
            if (url) { vscode.env.openExternal(vscode.Uri.parse(url)); }
        })
    );

    // Create a git branch for a ticket. Expects the ticket node's url or an object with number and label.
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.createBranch', async (arg: any) => {
            // arg may be the url string (from TreeItem.command arguments) or the TicketNode object
            let ticketNumber: string | undefined;
            let label: string | undefined;

            if (typeof arg === 'string') {
                // Try to extract ticket number from url, fallback to ask
                const m = arg.match(/\/(?:Story|Ticket|Defect)?\/?(\d+)/i);
                ticketNumber = m ? m[1] : undefined;
            } else if (arg && typeof arg === 'object') {
                ticketNumber = arg.number || arg.id || undefined;
                label = arg.label || arg.name || undefined;
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
                // remove leading ticket identifiers like S-12345, s_12345, 12345, or prefixes like "s 12345"
                t = t.replace(/^(s[-_\s]?\d+\b)[:\-\s_]*/i, '');
                t = t.replace(/^(\d+\b)[:\-\s_]*/i, '');
                // normalize to underscores
                t = t.replace(/[^a-z0-9]+/g, '_');
                t = t.replace(/^_+|_+$/g, '');
                t = t.replace(/_+/g, '_');
                return t;
            };

            // Remove any occurrences of the ticket number (variants like S-12345, s_12345, or plain digits)
            let titleForSlug = label || '';
            if (ticketNumber) {
                const digits = ticketNumber.replace(/\D/g, '');
                if (digits) {
                    // remove variants like 'S-12345', 's_12345', '12345' anywhere in the title
                    titleForSlug = titleForSlug.replace(new RegExp(`(s[-_\\s]?${digits}|${digits})`, 'ig'), '');
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
            if (url !== undefined) { await config.update('instanceUrl', url?.trim(), true); }

            const token = await vscode.window.showInputBox({
                title: 'Personal Access Token',
                password: true,
                ignoreFocusOut: true,
                placeHolder: 'pat:...'
            });
            if (token !== undefined) { await config.update('accessToken', token?.trim(), true); }

            if (url || token) {
                vscode.window.showInformationMessage('Agility configured! Refresh tickets to load.');
                provider['tickets'] = [];
                provider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility-helper.uploadCert', () => (provider as any).uploadCustomCert())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.changeMember', () => {
            (provider as any).changeMember();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.clearMember', () => {
            (provider as any).clearMember();
        })
    );
}
