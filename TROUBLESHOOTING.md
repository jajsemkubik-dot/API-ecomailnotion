# Troubleshooting Guide - Notion ↔ Ecomail Sync

## Critical Fix Applied

**GitHub Actions Configuration Issue**: The workflow was using `vars` instead of `secrets`. This has been fixed.

**Action Required**: Ensure your GitHub secrets are configured at:
- Repository → Settings → Secrets and variables → Actions → Secrets

Required secrets:
- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `ECOMAIL_API_KEY`
- `ECOMAIL_LIST_ID`

## Running Diagnostics

To identify the issue preventing sync from working, run:

```bash
node diagnose.mjs
```

This will show:
1. Whether environment variables are set
2. Notion database connection and Subscribe field structure
3. Ecomail API connection and status format
4. Whether status is returned as string or number

## Common Issues and Solutions

### Issue 1: Subscribe Field Configuration

**Symptom**: Contacts not syncing or unsubscribe not working

**Check**:
```bash
node diagnose.mjs
```

Look for the Subscribe property output. It should show:

```json
{
  "type": "select",
  "select": {
    "name": "Yes"  // or "No"
  }
}
```

**Fix if wrong**:
- In Notion, the Subscribe field MUST be:
  - Type: **Select** (NOT Checkbox)
  - Options: Exactly `Yes` and `No` (case-sensitive)
  - Each contact must have a value selected (not empty)

### Issue 2: Environment Variables Not Set

**Symptom**: Script fails immediately with "environment variable is not set"

**Check**:
```bash
# For local testing
cat .env
```

**Fix**:
1. Copy `.env.example` to `.env`
2. Fill in your actual credentials
3. For GitHub Actions, add secrets as described above

### Issue 3: Ecomail API Returns Strings Instead of Numbers

**Symptom**: Contacts show as changed every sync run

The code now handles both formats:
- String: `'SUBSCRIBED'`, `'UNSUBSCRIBED'`
- Number: `1`, `2`, `4`, `5`, `6`

The `normalizeEcomailStatus()` function converts strings to numbers automatically.

### Issue 4: Null Subscribe Values Cause Unsubscribe

**Symptom**: Contacts without Subscribe value get unsubscribed

**Fix**: The code now skips contacts where Subscribe is not set:

```javascript
if (contact.subscribeRaw === null) {
  console.log(`⚠️  Skipping ${contact.email}: Subscribe field not set`);
  skippedCount++;
  continue;
}
```

**Action**: Ensure all contacts have Subscribe set to either "Yes" or "No"

### Issue 5: Tags Not Syncing for Unsubscribed Contacts

**Symptom**: Unsubscribed contacts don't get tag updates

**Fix**: The code now uses `updateUnsubscribedContact()` to update tags while maintaining unsubscribed status.

## Step-by-Step Debugging

### Step 1: Run Diagnostics Locally

```bash
node diagnose.mjs
```

Save the output and check:
- ✓ All environment variables are set
- ✓ Notion connection succeeds
- ✓ Subscribe field is **Select** type
- ✓ Subscribe values are "Yes" and "No" (not true/false)
- ✓ Ecomail connection succeeds
- ✓ Status normalization tests pass

### Step 2: Test Local Sync

```bash
# Sync Notion → Ecomail
npm run sync

# Sync Ecomail → Notion (tags only)
npm run sync:from-ecomail

# Both directions
npm run sync:both
```

Watch for error messages and note which emails fail.

### Step 3: Check GitHub Actions

1. Go to repository → Actions tab
2. Click "Bi-directional Notion ↔ Ecomail Sync"
3. Click "Run workflow" to trigger manually
4. Click on the running workflow to see logs
5. Expand each step to see detailed output

### Step 4: Verify Notion Database Structure

Required properties in Notion:
- **Email** (Email type) - Required for all contacts
- **Subscribe** (Select type) - Options: "Yes", "No"
- **Jméno** (Text type) - Optional
- **Příjmení** (Text type) - Optional
- **Firma** (Text type) - Optional
- **Tags** (Multi-select type) - Optional

### Step 5: Test Specific Contact

Edit `diagnose.mjs` to add detailed logging for a specific email:

```javascript
// After line 147, add:
if (email === 'test@example.com') {
  console.log('   Full subscriber data:', JSON.stringify(subData, null, 2));
}
```

## Expected Sync Behavior

### Subscribe = "Yes" (Notion)
1. Checks if contact exists in Ecomail
2. Checks if status = 1 (SUBSCRIBED) and all fields match
3. If no changes: Skips with `⏭️  No changes: email`
4. If changes: Updates with `✅ Subscribed: email`

### Subscribe = "No" (Notion)
1. Checks if contact exists in Ecomail
2. If status = 2 (UNSUBSCRIBED):
   - Checks if tags/info need updating
   - Updates if needed: `✅ Updated (unsubscribed): email`
   - Skips if no changes: `⏭️  Already unsubscribed: email`
3. If status = 1 (SUBSCRIBED):
   - Unsubscribes: `✅ Unsubscribed: email`

### Subscribe = null (Notion)
- Skips: `⚠️  Skipping email: Subscribe field not set`

## API Endpoints Used

### Notion API
- `POST /v1/databases/{id}/query` - Fetch contacts
- `PATCH /v1/pages/{id}` - Update contact

### Ecomail API
- `GET /lists/{list_id}/subscriber/{email}` - Check subscriber status
- `POST /lists/{list_id}/subscribe` - Subscribe/update subscriber
- `PUT /lists/{list_id}/update-subscriber` - Unsubscribe or update unsubscribed contact
- `GET /lists/{list_id}/subscribers?page={n}&skip_unsubscribed=false` - Fetch all subscribers

## Status Codes

Ecomail uses these status codes:
- `1` = SUBSCRIBED
- `2` = UNSUBSCRIBED
- `4` = HARD_BOUNCE
- `5` = SPAM_COMPLAINT
- `6` = UNCONFIRMED

## Still Not Working?

If sync still fails after checking all above:

1. **Get the exact error message** from GitHub Actions logs
2. **Run diagnostic script** and save full output
3. **Check one specific contact**:
   - What is Subscribe value in Notion?
   - What is status in Ecomail?
   - Run sync and see what action it takes
4. **Verify API credentials**:
   - Test Notion token at: https://api.notion.com/v1/users/me
   - Test Ecomail key: `curl -H "key: YOUR_KEY" https://api2.ecomailapp.cz/lists/YOUR_LIST_ID`

## Quick Reference

### Check if Issue is Fixed

Run sync and look for these success indicators:

```
✅ Subscribed: email@example.com      # Subscribe = "Yes" processed
✅ Unsubscribed: email@example.com    # Subscribe = "No" processed
✅ Updated (unsubscribed): email@example.com  # Tags updated while staying unsubscribed
⏭️  No changes: email@example.com     # Already in sync
⏭️  Already unsubscribed: email@example.com  # Already unsubscribed, no tag changes
```

Avoid these error indicators:

```
❌ Failed to subscribe email@example.com: 401 - Unauthorized
❌ Failed to unsubscribe email@example.com: 404 - Not Found
⚠️  Skipping contact without email
⚠️  Skipping email@example.com: Subscribe field not set
```
