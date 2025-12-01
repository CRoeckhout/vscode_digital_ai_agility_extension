/**
 * Command registration for the Agility extension.
 * Centralizes all command registrations.
 */

import * as vscode from 'vscode';
import { registerConfigureCommand } from './configureCommand';
import { registerGitBranchCommand } from './gitBranchCommand';
import { registerStatusCommands } from './statusCommands';
import { registerTicketCommands } from './ticketCommands';
import { openTicketDetail } from '../providers/ticketDetailPanel';

/**
 * Interface for view providers that support refresh.
 */
export interface RefreshableProvider {
  refresh(): void;
}

/**
 * Interface for view providers that support member operations.
 */
export interface MemberProvider extends RefreshableProvider {
  changeMember(): Promise<void>;
  clearMember(): Promise<void>;
  getSelectedMemberId(): string | null;
}

/**
 * Interface for view providers that support team operations.
 */
export interface TeamProvider extends RefreshableProvider {
  changeTeam(): Promise<void>;
  clearTeam(): Promise<void>;
}

/**
 * Interface for status tree provider.
 */
export interface StatusProvider extends RefreshableProvider {
  setDevInProgress(item: unknown): Promise<void>;
  clearDevInProgress(item: unknown): Promise<void>;
  changeColor(item: unknown): Promise<void>;
  toggleVisibility(item: unknown): Promise<void>;
}

/**
 * Registers all commands for the extension.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  myTicketsProvider: MemberProvider,
  teamTicketsProvider: TeamProvider,
  statusProvider: StatusProvider
): void {
  // Helper to refresh all views
  const refreshViews = (): void => {
    myTicketsProvider.refresh();
    teamTicketsProvider.refresh();
    statusProvider.refresh();
  };

  // Configuration command
  registerConfigureCommand(context, refreshViews);

  // Git branch command
  registerGitBranchCommand(
    context,
    () => myTicketsProvider.getSelectedMemberId(),
    refreshViews
  );

  // Status commands
  registerStatusCommands(context, refreshViews);

  // Ticket commands
  registerTicketCommands(context, openTicketDetail);

  // Member commands (My Tickets view)
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

  // Team commands (Team Tickets view)
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

  // Internal refresh commands for providers
  context.subscriptions.push(
    vscode.commands.registerCommand('agility.myTickets.refresh', () => {
      myTicketsProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agility.teamTickets.refresh', () => {
      teamTicketsProvider.refresh();
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
        await statusProvider.setDevInProgress(item);
        myTicketsProvider.refresh();
        teamTicketsProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agility.status.clearDevInProgress', async (item: unknown) => {
      if (item && typeof item === 'object' && 'statusConfig' in item) {
        await statusProvider.clearDevInProgress(item);
        myTicketsProvider.refresh();
        teamTicketsProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agility.status.changeColor', async (item: unknown) => {
      if (item && typeof item === 'object' && 'statusConfig' in item) {
        await statusProvider.changeColor(item);
        myTicketsProvider.refresh();
        teamTicketsProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agility.status.toggleVisibility', async (item: unknown) => {
      if (item && typeof item === 'object' && 'statusConfig' in item) {
        await statusProvider.toggleVisibility(item);
        myTicketsProvider.refresh();
        teamTicketsProvider.refresh();
      }
    })
  );
}
