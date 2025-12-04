# Fixes Applied to Notion-Ecomail Sync

This document summarizes all the fixes and improvements made to resolve synchronization issues.

## Critical Fixes

### 1. GitHub Actions Configuration (CRITICAL)
**Issue**: Workflow was using `vars.*` instead of `secrets.*` for credentials
**Impact**: Environment variables were not being passed to the sync scripts
**Fix**: Changed all `vars.*` references to `secrets.*` in `.github/workflows/notion-ecomail-sync.yml`

**Before**:
```yaml
env:
  NOTION_TOKEN: ${{ vars.NOTION_TOKEN }}
```

**After**:
```yaml
env:
  NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
```

**Action Required**: Ensure credentials are added as **Secrets** (not Variables) in GitHub repository settings.

### 2. Field Name and Type Change
**Issue**: Changed from "Subscribe" Checkbox to "Marketingový status" Select type
**Fix**: Updated `extractContactData()` function in `sync.mjs`

**Before**:
```javascript
const subscribe = properties.Subscribe?.checkbox || false;
```

**After**:
```javascript
const subscribeValue = properties['Marketingový status']?.select?.name || null;
const subscribe = subscribeValue === 'Ano';
```

### 3. Null Field Handling
**Issue**: Contacts without Marketingový status value were treated as `false`, triggering unsubscribe
**Impact**: Blank fields caused unwanted unsubscribe actions
**Fix**: Added explicit null check in main sync loop

```javascript
if (contact.subscribeRaw === null) {
  console.log(`⚠️  Skipping ${contact.email}: Marketingový status field not set`);
  skippedCount++;
  continue;
}
```

### 4. Unsubscribe Endpoint
**Issue**: Initially used DELETE endpoint which wasn't working
**Fix**: Changed to PUT `/update-subscriber` with `status: 2`

**Before**:
```javascript
// DELETE /lists/{list_id}/unsubscribe/{email}
```

**After**:
```javascript
// PUT /lists/{list_id}/update-subscriber
const payload = {
  subscriber_data: {
    email: email,
    status: ECOMAIL_STATUS.UNSUBSCRIBED  // = 2
  }
};
```

## Bug Fixes

### 5. String vs Numeric Status Handling
**Issue**: Ecomail API may return status as string ('SUBSCRIBED') or number (1)
**Impact**: Status comparisons failed, causing repeated update attempts
**Fix**: Added `normalizeEcomailStatus()` function (lines 31-47)

```javascript
function normalizeEcomailStatus(status) {
  if (status === null || status === undefined) {
    return 'NOT_FOUND';
  }
  if (typeof status === 'number') {
    return status;
  }
  if (typeof status === 'string') {
    return STATUS_STRING_TO_CODE[status] || status;
  }
  return status;
}
```

### 6. Tag Updates for Unsubscribed Contacts
**Issue**: Unsubscribed contacts weren't getting tag updates
**Impact**: Tags couldn't be changed without re-subscribing
**Fix**: Created `updateUnsubscribedContact()` function (lines 229-261)

This function:
- Updates contact info (name, surname, company)
- Updates tags
- Maintains `status: 2` (UNSUBSCRIBED)

### 7. Infinite Update Loop Prevention
**Issue**: `needsEcomailUpdate()` checked all fields, but updates only sent non-null values
**Impact**: Contacts showed as needing updates every sync run
**Example**: Notion has `name=null`, Ecomail has `name="John"` → detected difference but didn't send update

**Fix**: Modified `needsEcomailUpdate()` to only check non-null Notion values (lines 148-152)

**Before**:
```javascript
if (notionContact.name !== ecomailSubscriber.name) return true;
```

**After**:
```javascript
if (notionContact.name && notionContact.name !== ecomailSubscriber.name) return true;
```

## Improvements

### 8. Status Constants
Added clear constant definitions for Ecomail status codes:

```javascript
const ECOMAIL_STATUS = {
  SUBSCRIBED: 1,
  UNSUBSCRIBED: 2,
  HARD_BOUNCE: 4,
  SPAM_COMPLAINT: 5,
  UNCONFIRMED: 6
};
```

### 9. Comprehensive Logging
Improved log messages to show:
- `✅ Subscribed: email` - Successfully subscribed
- `✅ Unsubscribed: email` - Successfully unsubscribed
- `✅ Updated (unsubscribed): email` - Tags/info updated while remaining unsubscribed
- `⏭️  No changes: email` - Already in sync
- `⏭️  Already unsubscribed: email` - Already unsubscribed with no changes needed
- `⚠️  Skipping email: Subscribe field not set` - No Subscribe value

### 10. Error Handling
Enhanced error handling:
- Environment variable validation
- API response error logging with status codes
- Per-contact error isolation (one failure doesn't stop sync)
- Summary statistics at end

### 11. Sync Summary
Added detailed sync summary showing:
- Total contacts processed
- Subscribed/Updated count
- Unsubscribed count
- Skipped (no changes) count
- Failed count

## Sync Logic Flow

### For Subscribe = "Yes"
1. Fetch existing Ecomail subscriber
2. Normalize status (handle string/number)
3. Check if already subscribed with no changes → Skip
4. Otherwise → Call `addToEcomail()` with `status: 1`

### For Subscribe = "No"
1. Fetch existing Ecomail subscriber
2. Normalize status
3. If already unsubscribed (status = 2):
   - Check if tags/info changed
   - If changed → Call `updateUnsubscribedContact()` (keeps status = 2)
   - If no changes → Skip
4. If subscribed (status = 1):
   - Call `unsubscribeFromEcomail()` with `status: 2`

### For Subscribe = null
- Skip contact entirely (don't process)

## Configuration Requirements

### Notion Database
- **Email** (Email type) - Required
- **Marketingový status** (Select type) - Options: "Ano", "Ne" (case-sensitive)
- **Jméno** (Text type) - Optional
- **Příjmení** (Text type) - Optional
- **Firma** (Text type) - Optional
- **Tags** (Multi-select type) - Optional

### GitHub Secrets (NOT Variables)
- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `ECOMAIL_API_KEY`
- `ECOMAIL_LIST_ID`

## Files Modified

1. **sync.mjs** - Main sync logic (multiple fixes)
2. **.github/workflows/notion-ecomail-sync.yml** - Changed vars to secrets
3. **README.md** - Updated documentation for Select field and secrets configuration
4. **TROUBLESHOOTING.md** - New comprehensive troubleshooting guide
5. **diagnose.mjs** - Diagnostic script (unchanged, ready to use)
6. **sync-from-ecomail.mjs** - Unchanged (only syncs tags from Ecomail to Notion)

## Testing Checklist

- [ ] GitHub secrets are configured (Secrets, not Variables)
- [ ] Marketingový status field is Select type with "Ano"/"Ne" options
- [ ] All contacts have Marketingový status value set (not empty)
- [ ] Run `node diagnose.mjs` locally
- [ ] Run `npm run sync` locally and verify output
- [ ] Trigger GitHub Action manually
- [ ] Check GitHub Action logs for success
- [ ] Verify a Marketingový status="Ano" contact gets subscribed in Ecomail
- [ ] Verify a Marketingový status="Ne" contact gets unsubscribed in Ecomail
- [ ] Verify tag changes sync for unsubscribed contacts

## Next Steps

1. **Run diagnostic script**:
   ```bash
   node diagnose.mjs
   ```

2. **Test local sync**:
   ```bash
   npm run sync
   ```

3. **Verify GitHub secrets are configured correctly**

4. **Trigger manual GitHub Action run** and check logs

5. **If still not working**, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
