import * as vscode from 'vscode';
import { TicketsWebviewProvider } from './tickets/ticketsWebviewProvider';
import { StatusTreeProvider } from './views/statusTreeProvider';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
	// Create unified providers for both views
	const myTicketsProvider = new TicketsWebviewProvider(context, 'agility', 'my-tickets');
	const teamTicketsProvider = new TicketsWebviewProvider(context, 'agility-team', 'team-tickets');
	const statusProvider = new StatusTreeProvider(context);

	// Register webview providers
	vscode.window.registerWebviewViewProvider('agility', myTicketsProvider);
	vscode.window.registerWebviewViewProvider('agility-team', teamTicketsProvider);

	// Register tree data provider for status
	vscode.window.registerTreeDataProvider('agility-status', statusProvider);

	// Register commands with all providers
	registerCommands(context, myTicketsProvider, teamTicketsProvider, statusProvider);
}

export function deactivate(): void {
	// Cleanup if needed
}