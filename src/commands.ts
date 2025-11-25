import * as vscode from 'vscode';
import { AgilityTicketProvider } from './ticketProvider';

export function registerCommands(context: vscode.ExtensionContext, provider: AgilityTicketProvider) {
    context.subscriptions.push(
        vscode.commands.registerCommand('agility.refresh', () => {
            provider['tickets'] = [];
            provider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.openInBrowser', (url: string) => {
            vscode.env.openExternal(vscode.Uri.parse(url));
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
        vscode.commands.registerCommand('agility-helper.uploadCert', () => provider.uploadCustomCert())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agility.changeMember', () => {
            provider.changeMember();
        })
    );
}
