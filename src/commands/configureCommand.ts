/**
 * Configuration command for setting up the Agility extension.
 */

import * as vscode from 'vscode';
import { setInstanceUrl, setAccessToken, getInstanceUrl, getAccessToken } from '../config';

/**
 * Registers the configure command.
 */
export function registerConfigureCommand(
  context: vscode.ExtensionContext,
  onConfigured: () => void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('agility-helper.configure', async () => {
      const currentUrl = getInstanceUrl() ?? '';
      
      const url = await vscode.window.showInputBox({
        title: 'Agility Instance URL',
        placeHolder: 'https://www12.v1host.com/YourCompany',
        ignoreFocusOut: true,
        value: currentUrl,
      });

      if (url !== undefined) {
        await setInstanceUrl(url);
      }

      const token = await vscode.window.showInputBox({
        title: 'Personal Access Token',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'pat:...',
      });

      if (token !== undefined) {
        await setAccessToken(token);
      }

      if (url ?? token) {
        vscode.window.showInformationMessage('Agility configured! Refresh tickets to load.');
        onConfigured();
      }
    })
  );
}
