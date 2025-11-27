# Digital.ai Agility Helper

Digital.ai Agility Helper is a small VS Code extension that helps you manage Digital.ai Agility tickets directly from the editor. It adds an activity-bar view where you can see your tickets, open ticket details, open a ticket in the Agility web UI, create Git branches for tickets, and switch the selected team member.

Images used by the extension live in the `images/` folder and are referenced from contributions in `package.json`.

## Features

- Activity Bar explorer titled "Digital.ai Agility" with a "My Tickets" view
- Commands provided (see Command Palette):
	- Agility: Configure
	- Agility: Show My Open Tickets
	- Refresh
	- Open in Agility
	- Open ticket details
	- Agility: Change Member
	- Create Git Branch
	- Clear selected member
- Persistently store a selected team member via the `agility.selectedMember` setting
- Open tickets in the browser and create git branches based on ticket identifiers

## Quick Install

1. Install the packaged extension (.vsix) from the Marketplace or local file. If you have a `.vsix` file:

```powershell
code --install-extension .\agility-helper-<version>.vsix
```

2. Reload VS Code. The "Digital.ai Agility" icon should appear in the Activity Bar.

## Configuration

Open Settings (File → Preferences → Settings) and search for "Agility" or use the settings editor to set these values:

- `agility.instanceUrl` — Your Agility instance URL (e.g. https://www12.v1host.com/YourCompany)
- `agility.accessToken` — Personal Access Token (stored securely via VS Code settings storage)
- `agility.selectedMember` — Optional: the ID of a team member to filter the My Tickets view

The extension contributes settings in `package.json` and validates the `instanceUrl` format.

## Usage

1. Configure `agility.instanceUrl` and `agility.accessToken`.
2. Use the Activity Bar → Digital.ai Agility → My Tickets to view tickets.
3. Use the View title menu or item context menus to refresh, open in browser, or create a branch.
4. Use the Command Palette (Ctrl+Shift+P) to run commands like "Agility: Configure" or "Create Git Branch".

## Development

Clone the repo and install dependencies, then compile:

```powershell
npm install
npm run compile
```

During development you can run in watch mode:

```powershell
npm run watch
```

To run the extension in the Extension Development Host (inside VS Code) use the built-in debug target (F5).

### Tests

Unit/e2e tests (if present) run via the `test` script which uses the VS Code test harness:

```powershell
npm test
```

## Packaging (create a .vsix)

Use `vsce` (or `npx @vscode/vsce`) to package the extension after compiling to `out/`:

```powershell
npm run compile
npx @vscode/vsce package
```

This will produce a file like `agility-helper-0.0.1.vsix` based on `package.json` name/version.

If `npx @vscode/vsce package` fails with an error referencing `undici`/`File is not defined`, upgrade Node to a modern LTS (Node 18.15+ or Node 20.x) as the packager relies on newer Node web platform globals. See Troubleshooting below.

## Publishing to the Visual Studio Marketplace

1. Ensure `publisher` in `package.json` matches your Marketplace publisher ID (the project currently lists `"publisher": "Realize"`).
2. Create or use an existing publisher on the Marketplace and generate a Personal Access Token (PAT) with the `Manage` and `Publish` scopes.
3. Publish with `vsce`:

```powershell
$env:VSCE_PAT = '<your-pat-here>'
npx @vscode/vsce publish
```

Or use `npx @vscode/vsce publish <patch|minor|major>` to bump the version automatically.

Important: do not share your PAT publicly.

## Troubleshooting

- Problem: `ReferenceError: File is not defined` when running `npx vsce package`.
	- Cause: `undici` (used by the packager) expects Web `File` global; older Node versions may lack it.
	- Fix: Upgrade Node to an LTS version (Node 18.15+ or Node 20.x) and retry:

```powershell
node -v
# use nvm-windows or the official Node installer to upgrade
```

- Problem: `out/extension.js` missing after compile
	- Ensure TypeScript compiled successfully (`npm run compile`). Fix any TypeScript errors reported by the compiler.

## Contributing

Contributions are welcome. Typical workflow:

1. Fork the repo
2. Create a feature branch
3. Implement and test your change
4. Open a Pull Request with a clear description

Please follow the repository's existing code style and tests.

## License

This project is licensed under the MIT License — see the `LICENSE` file for details.

## Contact

If you need help or want to report a bug, open an issue in this repository or email the maintainers.

---

This README was generated to help you get the extension packaged, published, and used in VS Code. If you want, I can also add a short `CONTRIBUTING.md`, a release checklist, or automate the packaging step in `package.json`.
