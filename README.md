# Digital.ai Agility Helper

A VS Code extension to manage Digital.ai Agility tickets directly from your editor. View your tickets, open ticket details, create Git branches, and configure status colors — all without leaving VS Code.

## Roadmap

  [X] Connect to On-premise Agility
  [X] See the list of items / teams / users
  [X] Item details view / Open in browser
  [X] Automated Branch creation + Set to "Dev in progress"
  [ ] Iteration filter
  [ ] Team view (storyboard)
  [ ] Full details view edition (description, status, owners, ...)
  [ ] Automated "Review" Status


## Features

### Views (Activity Bar → Digital.ai Agility)

- **My Tickets** — View tickets assigned to a selected team member, grouped by status
- **Team Tickets** — View all tickets for a selected team, grouped by status
- **Status Configuration** — Configure status colors and set the "Dev in Progress" status

### Commands (Command Palette: `Ctrl+Shift+P`)

| Command | Description |
|---------|-------------|
| `Agility: Configure` | Set up your Agility instance URL and access token |
| `Agility: Change Member` | Select a team member to filter "My Tickets" view |
| `Agility: Change Team` | Select a team for the "Team Tickets" view |
| `Agility: Configure Status Colors` | Customize status badge colors |
| `Agility: Set Dev in Progress Status` | Choose which status to apply when creating branches |
| `Create Git Branch` | Create a Git branch from a ticket (format: `<type>/<id>-<title>`) |
| `Open in Agility` | Open the selected ticket in your browser |
| `Refresh` | Refresh the ticket views |

### Key Features

- **Ticket grouping by status** with customizable colors
- **Create Git branches** from tickets with automatic naming (`story/S-12345-ticket-title` or `defect/D-12345-fix-description`)
- **Auto-update ticket status** to "Dev in Progress" when creating a branch
- **Open ticket details** in a rich webview panel with description, acceptance criteria, and more
- **Persistent selections** — your member and team selections are saved across sessions

## Quick Install

### From VSIX file

```powershell
code --install-extension .\agility-helper-<version>.vsix
```

### From Source

```powershell
git clone <repository-url>
cd agility-helper
npm install
npm run compile
# Press F5 to run in Extension Development Host
```

## Configuration

Open **Settings** (`Ctrl+,`) and search for "Agility", or configure via `settings.json`:

### Required Settings

| Setting | Type | Description |
|---------|------|-------------|
| `agility.instanceUrl` | `string` | Your Agility instance URL (e.g., `https://www12.v1host.com/YourCompany`) |
| `agility.accessToken` | `string` | Your Personal Access Token from Agility |

### Optional Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `agility.selectedMember` | `string \| null` | `null` | Team member ID for "My Tickets" view. Set via `Agility: Change Member` command. |
| `agility.selectedTeam` | `string \| null` | `null` | Team ID for "Team Tickets" view. Set via `Agility: Change Team` command. |
| `agility.statusConfig` | `object` | `{}` | Status color and visibility configuration. Auto-populated via Status Configuration view. |
| `agility.devInProgressStatusId` | `string \| null` | `null` | *(Legacy)* Status ID for "Dev in Progress". Use Status Configuration view instead. |

### Example `settings.json`

```json
{
  "agility.instanceUrl": "https://www12.v1host.com/YourCompany",
  "agility.accessToken": "your-personal-access-token",
  "agility.selectedMember": "12345",
  "agility.selectedTeam": "6789",
  "agility.statusConfig": {
    "12345": {
      "id": "12345",
      "name": "In Development",
      "color": "#2ca02c",
      "isDevInProgress": true,
      "hidden": false
    }
  }
}
```

## Getting Your Access Token

1. Log into your Digital.ai Agility instance
2. Go to your profile settings (click your avatar → **My Profile**)
3. Navigate to **Applications** or **API Tokens**
4. Create a new Personal Access Token
5. Copy the token and paste it into the `agility.accessToken` setting

> ⚠️ **Security Note**: Your access token is stored in VS Code's settings. Consider using VS Code's Settings Sync exclusions if you sync settings across machines.

## Usage

### Initial Setup

1. Run `Agility: Configure` from the Command Palette
2. Enter your Agility instance URL
3. Enter your Personal Access Token
4. Select a team member for "My Tickets" (or a team for "Team Tickets")

### Viewing Tickets

1. Click the **Digital.ai Agility** icon in the Activity Bar
2. Your tickets appear grouped by status with color-coded badges
3. Click a ticket to open its details in a panel
4. Right-click for context menu options (Open in Browser, Create Branch, etc.)

### Creating Git Branches

1. Right-click a ticket → **Create Git Branch**
2. Or use the Command Palette: `Create Git Branch`
3. The extension will:
   - Generate a branch name: `story/S-12345-ticket-title` or `defect/D-12345-description`
   - Create and checkout the branch
   - Optionally update the ticket status to "Dev in Progress"

### Configuring Status Colors

1. Select a team first (required to load statuses)
2. Open the **Status Configuration** view
3. Click a status to:
   - **Change Color** — Pick from presets or enter a custom hex color
   - **Set as Dev in Progress** — Mark this status for branch creation
   - **Toggle Visibility** — Hide/show status groups in ticket views

## Development

```powershell
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (auto-recompile on changes)
npm run watch

# Run linter
npm run lint

# Run tests
npm test
```

Press **F5** in VS Code to launch the Extension Development Host.

## Packaging

Create a `.vsix` package for distribution:

```powershell
npm run compile
npx @vscode/vsce package
```

This produces `agility-helper-<version>.vsix`.

> **Note**: Requires Node.js 18.15+ or 20.x. Older versions may fail with `File is not defined` errors.

## Publishing to VS Marketplace

1. Ensure `publisher` in `package.json` matches your Marketplace publisher ID
2. Create a Personal Access Token (PAT) with `Manage` and `Publish` scopes
3. Publish:

```powershell
$env:VSCE_PAT = '<your-pat>'
npx @vscode/vsce publish
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `ReferenceError: File is not defined` when packaging | Upgrade Node.js to 18.15+ or 20.x |
| `out/extension.js` missing | Run `npm run compile` and fix any TypeScript errors |
| Tickets not loading | Verify `instanceUrl` and `accessToken` are correct |
| Status colors not saving | Ensure you have a team selected first |
| "No member selected" message | Run `Agility: Change Member` to select a team member |

## Project Structure

```
src/
├── api/           # API services (tickets, members, teams, statuses)
├── commands/      # Command handlers
├── config/        # Configuration service
├── constants/     # Color presets
├── errors/        # Custom error classes
├── models/        # TypeScript interfaces
├── providers/     # Webview and tree providers
├── utils/         # Shared utilities
└── extension.ts   # Entry point
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run lint` and `npm run compile`
5. Open a Pull Request

## License

MIT — see [LICENSE](LICENSE) for details.

## Contact

Open an issue in this repository for bug reports or feature requests.
