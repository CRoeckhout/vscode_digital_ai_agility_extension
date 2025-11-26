import * as vscode from 'vscode';
import { AgilityTicketProvider } from './tickets/provider';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext) {
	const provider = new AgilityTicketProvider(context);
	vscode.window.registerTreeDataProvider('agility', provider);
	registerCommands(context, provider);
}

export function deactivate() { }