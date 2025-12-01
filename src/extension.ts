import * as vscode from 'vscode';
import { AgilityTicketProvider } from './tickets/provider';
import { TeamWebviewProvider } from './tickets/teamWebviewProvider';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext) {
	const provider = new AgilityTicketProvider(context);
	const teamProvider = new TeamWebviewProvider(context);
	vscode.window.registerTreeDataProvider('agility', provider);
	vscode.window.registerWebviewViewProvider(TeamWebviewProvider.viewType, teamProvider);
	registerCommands(context, provider, teamProvider);
}

export function deactivate() { }