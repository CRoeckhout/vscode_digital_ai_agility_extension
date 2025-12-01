/**
 * Ticket-related commands for the Agility extension.
 */

import * as vscode from 'vscode';
import { TicketData } from '../models';

/**
 * Callback type for opening ticket details.
 */
type OpenTicketCallback = (context: vscode.ExtensionContext, arg: unknown) => Promise<void>;

/**
 * Registers all ticket-related commands.
 */
export function registerTicketCommands(
  context: vscode.ExtensionContext,
  openTicketDetail: OpenTicketCallback
): void {
  // Refresh command for My Tickets view
  context.subscriptions.push(
    vscode.commands.registerCommand('agility.refresh', () => {
      vscode.commands.executeCommand('agility.myTickets.refresh');
    })
  );

  // Team refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('agility-team.refresh', () => {
      vscode.commands.executeCommand('agility.teamTickets.refresh');
    })
  );

  // Open ticket in external browser
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to open ticket: ${message}`);
      }
    })
  );
}
