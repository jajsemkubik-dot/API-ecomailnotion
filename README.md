# Bi-directional Notion ↔ Ecomail Contact Sync

Automatically sync contacts between Notion database and Ecomail mailing list using GitHub Actions with bi-directional synchronization.

## Features

### Notion → Ecomail Sync (Source of Truth: Notion)
- Syncs ALL contact data from Notion to Ecomail:
  - Email, name, surname, company
  - **Tags** (Notion is the source of truth for tags)
- Filters only contacts with "Subcribe" checkbox checked
- Updates existing subscribers in Ecomail with Notion data
- Creates new subscribers in Ecomail for new Notion contacts

### Ecomail → Notion Sync (Source of Truth: Ecomail)
- Syncs **subscription status ONLY** from Ecomail to Notion
  - Updates "Subcribe" checkbox based on Ecomail subscriber status
  - Handles unsubscribes from Ecomail
- **Does NOT sync** tags, name, surname, or company (Notion remains authoritative for these fields)

### General
- Runs automatically every 15 minutes via GitHub Actions
- Can be triggered manually from GitHub Actions interface
- Comprehensive error handling and logging
- Detailed sync reports

## Prerequisites

- Node.js 18+ (for local development)
- Notion account with:
  - Integration created at https://www.notion.so/my-integrations
  - Database shared with the integration
- Ecomail account with API access

## Notion Database Structure

Your Notion database should have these properties:

- **Email** (Email type) - Contact's email address
- **Jméno** (Text type) - First name
- **Příjmení** (Text type) - Surname/Last name
- **Firma** (Text type) - Company name
- **Subscribed** (Checkbox type) - Subscription status

## Setup

### 1. Clone or Download this Repository

```bash
git clone <your-repo-url>
cd notion-ecomail-sync
```

### 2. Install Dependencies (for local testing)

```bash
npm install
```

### 3. Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add the following secrets:

| Secret Name | Value | Where to Find |
|-------------|-------|---------------|
| `NOTION_TOKEN` | Your Notion integration token | https://www.notion.so/my-integrations |
| `NOTION_DATABASE_ID` | Your Notion database ID | From the database URL |
| `ECOMAIL_API_KEY` | Your Ecomail API key | Ecomail account → Settings → For Developers |
| `ECOMAIL_LIST_ID` | Your Ecomail list ID | Your list ID (usually a number) |

#### How to Find Notion Database ID

From your Notion database URL:
```
https://www.notion.so/yourworkspace/2bc7e14c4bef800b9daee6ea48dfad4b?v=...
                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                   This is your database ID
```

### 4. Enable GitHub Actions

- Push this repository to GitHub
- Go to the "Actions" tab in your repository
- GitHub Actions will automatically start running based on the schedule (every 15 minutes)

## Usage

### Automatic Sync

The sync runs automatically every 15 minutes via GitHub Actions.

### Manual Sync

1. Go to the "Actions" tab in your GitHub repository
2. Select "Notion to Ecomail Sync" workflow
3. Click "Run workflow" button
4. Click the green "Run workflow" button in the dropdown

### Local Testing

Create a `.env` file (copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

```env
NOTION_TOKEN=ntn_your_token_here
NOTION_DATABASE_ID=your_database_id_here
ECOMAIL_API_KEY=your_api_key_here
ECOMAIL_LIST_ID=1
```

Run the sync locally:

```bash
npm run sync
```

## How It Works

1. **Query Notion**: Fetches all contacts from the Notion database where `Subscribed` checkbox is `true`
2. **Extract Data**: Extracts email, name, surname, and company from each contact
3. **Sync to Ecomail**: Sends each contact to Ecomail API
   - If contact exists: Updates their information
   - If contact is new: Adds them to the list
4. **Logging**: Outputs detailed logs of success/failure for each contact

## Troubleshooting

### Workflow not running?

- Check that GitHub Actions is enabled for your repository
- Verify all secrets are properly configured
- Check the Actions tab for error messages

### Sync failing?

- Verify your Notion integration has access to the database
- Check that all required secrets are set correctly
- Review the workflow logs in GitHub Actions for specific errors
- Ensure your Notion database has the correct property names

### Contacts not syncing?

- Verify the "Subscribed" checkbox is checked for contacts you want to sync
- Ensure the Email property is not empty
- Check that property names match exactly (case-sensitive)

## Customization

### Change Sync Frequency

Edit [.github/workflows/notion-ecomail-sync.yml](.github/workflows/notion-ecomail-sync.yml):

```yaml
schedule:
  - cron: '*/15 * * * *'  # Every 15 minutes
```

Examples:
- Every hour: `'0 * * * *'`
- Every 6 hours: `'0 */6 * * *'`
- Daily at midnight: `'0 0 * * *'`

### Modify Synced Fields

Edit [sync.mjs](sync.mjs) in the `extractContactData` function to add or remove fields.

## API Documentation

- [Notion API](https://developers.notion.com/)
- [Ecomail API](https://ecomailczv2.docs.apiary.io/)

## License

MIT
