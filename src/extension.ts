import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('agility');
	const instanceUrl = config.get<string>('instanceUrl')?.replace(/\/+$/, '');
	const token = config.get<string>('accessToken');

	// Quick config helper command
	context.subscriptions.push(
		vscode.commands.registerCommand('agility-helper.configure', async () => {
			const url = await vscode.window.showInputBox({
				title: "Agility Instance URL",
				placeHolder: "https://www12.v1host.com/YourCompany",
				value: instanceUrl,
				ignoreFocusOut: true
			});
			if (url) {
				await config.update('instanceUrl', url.trim(), true);
			}

			const tok = await vscode.window.showInputBox({
				title: "Personal Access Token",
				password: true,
				placeHolder: "pat:abc123...",
				ignoreFocusOut: true
			});
			if (tok) {
				await config.update('accessToken', tok.trim(), true);
			}

			vscode.window.showInformationMessage('Agility configuration saved securely!');
		})
	);

	// Later we’ll plug the real API calls here
	context.subscriptions.push(
		vscode.commands.registerCommand('agility-helper.showMyTickets', async () => {
			if (!instanceUrl || !token) {
				vscode.window.showWarningMessage('Please configure Agility first', 'Configure')
					.then(choice => choice === 'Configure' && vscode.commands.executeCommand('agility-helper.configure'));
				return;
			}

			vscode.window.showInformationMessage(`Connecting to ${instanceUrl} ...`);
			// ← here comes your working script later
		})
	);
}