import * as vscode from 'vscode';
import { AgilityTicketProvider } from './tickets/provider';
import TeamTicketProvider from './tickets/teamProvider';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext) {
	const provider = new AgilityTicketProvider(context);
	const teamProvider = new TeamTicketProvider(context);
	vscode.window.registerTreeDataProvider('agility', provider);
	vscode.window.registerTreeDataProvider('agility-team', teamProvider);
	registerCommands(context, provider, teamProvider);
}

export function deactivate() { }