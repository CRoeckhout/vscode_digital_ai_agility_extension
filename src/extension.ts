import * as vscode from 'vscode';
import { TicketsWebviewProvider } from './tickets/ticketsWebviewProvider';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
	// Create unified providers for both views
	const myTicketsProvider = new TicketsWebviewProvider(context, 'agility', 'my-tickets');
	const teamTicketsProvider = new TicketsWebviewProvider(context, 'agility-team', 'team-tickets');

	// Register both as webview providers
	vscode.window.registerWebviewViewProvider('agility', myTicketsProvider);
	vscode.window.registerWebviewViewProvider('agility-team', teamTicketsProvider);

	// Register commands with both providers
	registerCommands(context, myTicketsProvider, teamTicketsProvider);
}

export function deactivate(): void {
	// Cleanup if needed
}