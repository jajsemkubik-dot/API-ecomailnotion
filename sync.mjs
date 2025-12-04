import { Client } from '@notionhq/client';

// Configuration from environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ECOMAIL_API_KEY = process.env.ECOMAIL_API_KEY;
const ECOMAIL_LIST_ID = process.env.ECOMAIL_LIST_ID;

// Ecomail status codes (used when sending to API)
const ECOMAIL_STATUS = {
  SUBSCRIBED: 1,
  UNSUBSCRIBED: 2,
  HARD_BOUNCE: 4,
  SPAM_COMPLAINT: 5,
  UNCONFIRMED: 6
};

// Ecomail API may return status as strings - convert to numeric codes
const STATUS_STRING_TO_CODE = {
  'SUBSCRIBED': 1,
  'UNSUBSCRIBED': 2,
  'HARD_BOUNCE': 4,
  'SPAM_COMPLAINT': 5,
  'UNCONFIRMED': 6
};

/**
 * Normalize Ecomail status to numeric code
 * API may return string ('SUBSCRIBED') or number (1)
 */
function normalizeEcomailStatus(status) {
  if (status === null || status === undefined) {
    return 'NOT_FOUND';
  }

  // If already a number, return it
  if (typeof status === 'number') {
    return status;
  }

  // If string, convert to number
  if (typeof status === 'string') {
    return STATUS_STRING_TO_CODE[status] || status;
  }

  return status;
}

// Notion client will be initialized after validation in main()
let notion;

/**
 * Delay utility for rate limiting
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(url, options, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms: ${url}`);
    }
    throw error;
  }
}

/**
 * Fetch with retry logic and exponential backoff
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);

      // Handle rate limiting specially
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 2000;
        console.log(`⏱️  Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await delay(waitTime);
        continue;
      }

      return response;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;

      if (isLastAttempt) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`⚠️  Request failed (${error.message}), retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
      await delay(waitTime);
    }
  }
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Query Notion database for ALL contacts
 */
async function queryNotionDatabase() {
  console.log('📖 Querying Notion database for all contacts...');

  const pages = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: startCursor
    });

    pages.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  console.log(`✅ Found ${pages.length} total contacts`);
  return pages;
}

/**
 * Extract contact data from Notion page properties
 */
function extractContactData(page) {
  const properties = page.properties;

  // Extract tags from multiselect property
  const tags = properties.Tags?.multi_select?.map(tag => tag.name) || [];

  // Extract Marketingový status field (Select type with "Ano" or "Ne" values)
  // Try to find the property - check if it exists
  // Use Unicode normalization to handle different encodings of Czech characters
  let subscribeValue = null;
  const marketingPropName = 'Marketingový status'.normalize('NFC');

  // Try direct match first, then normalized search
  let marketingField = properties[marketingPropName];
  if (!marketingField) {
    // Try to find property with different Unicode normalization
    const matchingKey = Object.keys(properties).find(
      k => k.normalize('NFC') === marketingPropName
    );
    if (matchingKey) {
      marketingField = properties[matchingKey];
    }
  }

  if (!marketingField) {
    // Property not found - log available properties for debugging
    const availableProps = Object.keys(properties).join(', ');
    console.warn(`⚠️  Warning: 'Marketingový status' property not found. Available: ${availableProps}`);
  } else if (marketingField.type !== 'select') {
    console.warn(`⚠️  Warning: 'Marketingový status' is type '${marketingField.type}', expected 'select'`);
  } else {
    subscribeValue = marketingField.select?.name || null;
  }

  const subscribe = subscribeValue === 'Ano';

  return {
    email: properties.Email?.email || null,
    name: properties.Jméno?.rich_text?.[0]?.plain_text || null,
    surname: properties.Příjmení?.rich_text?.[0]?.plain_text || null,
    company: properties.Firma?.rich_text?.[0]?.plain_text || null,
    tags: tags,  // Keep empty array to allow clearing tags
    subscribe: subscribe,
    subscribeRaw: subscribeValue  // Keep raw value for debugging
  };
}

/**
 * Fetch existing subscriber from Ecomail to check for changes
 */
async function fetchEcomailSubscriber(email) {
  const url = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscriber/${encodeURIComponent(email)}`;

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'key': ECOMAIL_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (response.ok) {
    const data = await response.json();
    return data;
  }

  // 404 means subscriber doesn't exist - this is OK
  if (response.status === 404) {
    return null;
  }

  // Any other error is a real problem - throw so caller knows
  const errorText = await response.text();
  throw new Error(`Failed to fetch subscriber ${email}: ${response.status} ${response.statusText} - ${errorText}`);
}

/**
 * Check if contact needs update in Ecomail
 * Only checks fields that will actually be sent (non-null values from Notion)
 * IMPORTANT: This logic must exactly match what addToEcomail() sends
 */
function needsEcomailUpdate(notionContact, ecomailSubscriber) {
  if (!ecomailSubscriber) {
    // Subscriber doesn't exist in Ecomail, needs to be created
    return true;
  }

  // Compare tags - Always check if tags field exists (even if empty array)
  // This allows clearing tags by setting empty array in Notion
  // Use Array.isArray to safely handle null/undefined values
  if (Array.isArray(notionContact.tags)) {
    const notionTags = [...notionContact.tags].sort();  // Create copy to avoid mutation
    const ecomailTags = [...(ecomailSubscriber?.tags || [])].sort();

    if (notionTags.length !== ecomailTags.length) {
      return true;
    }

    for (let i = 0; i < notionTags.length; i++) {
      if (notionTags[i] !== ecomailTags[i]) {
        return true;
      }
    }
  }

  // Compare other fields - ONLY if Notion has non-null values
  // This matches the update logic which only sends non-null fields
  if (notionContact.name && notionContact.name !== ecomailSubscriber.name) return true;
  if (notionContact.surname && notionContact.surname !== ecomailSubscriber.surname) return true;
  if (notionContact.company && notionContact.company !== ecomailSubscriber.company) return true;

  return false;
}

/**
 * Add or update subscriber in Ecomail list
 * Status codes: 1=subscribed, 2=unsubscribed, 4=hard bounce, 5=spam complaint, 6=unconfirmed
 */
async function addToEcomail(contact) {
  const url = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscribe`;

  // Build subscriber_data object, only including non-null values
  const subscriber_data = {
    email: contact.email,
    status: ECOMAIL_STATUS.SUBSCRIBED
  };

  if (contact.name) subscriber_data.name = contact.name;
  if (contact.surname) subscriber_data.surname = contact.surname;
  if (contact.company) subscriber_data.company = contact.company;

  const payload = {
    subscriber_data,
    update_existing: true,
    resubscribe: true,  // CRITICAL: Required to re-subscribe previously unsubscribed contacts
    trigger_autoresponders: true,
    skip_confirmation: true
  };

  // Always send tags (even empty array to allow clearing)
  // Tags must be sent separately according to Ecomail API
  if (contact.tags !== undefined) {
    payload.tags = contact.tags;
  }

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'key': ECOMAIL_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return response;
}

/**
 * Unsubscribe contact from Ecomail list
 * According to Ecomail API docs: PUT /lists/{list_id}/update-subscriber
 * Status codes: 1=subscribed, 2=unsubscribed, 4=hard bounce, 5=spam complaint, 6=unconfirmed
 */
async function unsubscribeFromEcomail(email) {
  const url = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/update-subscriber`;

  const payload = {
    subscriber_data: {
      email: email,
      status: ECOMAIL_STATUS.UNSUBSCRIBED
    }
  };

  const response = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      'key': ECOMAIL_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return response;
}

/**
 * Update unsubscribed contact's information (tags, name, etc.) without changing subscription status
 * Used when contact is already unsubscribed but tags or other info need updating
 */
async function updateUnsubscribedContact(contact) {
  const url = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/update-subscriber`;

  // Build subscriber_data object, keeping UNSUBSCRIBED status
  const subscriber_data = {
    email: contact.email,
    status: ECOMAIL_STATUS.UNSUBSCRIBED  // Keep unsubscribed status
  };

  if (contact.name) subscriber_data.name = contact.name;
  if (contact.surname) subscriber_data.surname = contact.surname;
  if (contact.company) subscriber_data.company = contact.company;

  const payload = {
    subscriber_data
  };

  // Always send tags (even empty array to allow clearing)
  if (contact.tags !== undefined) {
    payload.tags = contact.tags;
  }

  const response = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      'key': ECOMAIL_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return response;
}

/**
 * Main sync function
 */
async function main() {
  console.log('🚀 Starting Notion to Ecomail sync...\n');

  // Validate environment variables
  if (!NOTION_TOKEN) {
    console.error('❌ Error: NOTION_TOKEN environment variable is not set');
    process.exit(1);
  }
  if (!NOTION_DATABASE_ID) {
    console.error('❌ Error: NOTION_DATABASE_ID environment variable is not set');
    process.exit(1);
  }
  if (!ECOMAIL_API_KEY) {
    console.error('❌ Error: ECOMAIL_API_KEY environment variable is not set');
    process.exit(1);
  }
  if (!ECOMAIL_LIST_ID) {
    console.error('❌ Error: ECOMAIL_LIST_ID environment variable is not set');
    process.exit(1);
  }

  // Initialize Notion client after validation
  notion = new Client({ auth: NOTION_TOKEN });

  try {
    // Query Notion for all contacts
    const pages = await queryNotionDatabase();

    if (pages.length === 0) {
      console.log('ℹ️  No contacts found');
      return;
    }

    console.log('\n📤 Syncing to Ecomail...\n');

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let unsubscribedCount = 0;

    // Process each contact
    for (const page of pages) {
      const contact = extractContactData(page);

      // Skip if no email or invalid email format
      if (!contact.email || !isValidEmail(contact.email)) {
        console.log(`⚠️  Skipping contact with invalid email: ${contact.email || '(empty)'}`);
        errorCount++;
        continue;
      }

      try {
        // Check if subscriber exists in Ecomail
        const ecomailSubscriber = await fetchEcomailSubscriber(contact.email);
        const ecomailStatus = normalizeEcomailStatus(ecomailSubscriber?.status);

        // Handle subscription status based on Notion
        // Only process if Marketingový status field is explicitly set (not null/undefined)
        if (contact.subscribeRaw === null) {
          console.log(`⚠️  Skipping ${contact.email}: Marketingový status field not set`);
          skippedCount++;
          continue;
        }

        if (contact.subscribe) {
          // Contact should be subscribed in Ecomail (Marketingový status = "Ano")
          if (ecomailStatus === ECOMAIL_STATUS.SUBSCRIBED && !needsEcomailUpdate(contact, ecomailSubscriber)) {
            console.log(`⏭️  No changes: ${contact.email}`);
            skippedCount++;
            continue;
          }

          const response = await addToEcomail(contact);

          if (response.ok) {
            // Validate response body - Ecomail might return 200 with error in body
            const result = await response.json();
            if (result.error) {
              console.error(`❌ API error for ${contact.email}: ${JSON.stringify(result)}`);
              errorCount++;
            } else {
              console.log(`✅ Subscribed: ${contact.email}`);
              successCount++;
            }
          } else {
            const errorText = await response.text();
            console.error(`❌ Failed to subscribe ${contact.email}: ${response.status} - ${errorText}`);
            errorCount++;
          }
        } else {
          // Contact should be unsubscribed in Ecomail (Marketingový status = "Ne")
          if (ecomailStatus === ECOMAIL_STATUS.UNSUBSCRIBED || ecomailStatus === 'NOT_FOUND') {
            // Already unsubscribed, but check if tags/info need updating
            if (ecomailStatus === ECOMAIL_STATUS.UNSUBSCRIBED && needsEcomailUpdate(contact, ecomailSubscriber)) {
              // Update tags/info while keeping unsubscribed status
              const response = await updateUnsubscribedContact(contact);

              if (response.ok) {
                // Validate response body - Ecomail might return 200 with error in body
                const result = await response.json();
                if (result.error) {
                  console.error(`❌ API error updating ${contact.email}: ${JSON.stringify(result)}`);
                  errorCount++;
                } else {
                  console.log(`✅ Updated (unsubscribed): ${contact.email}`);
                  successCount++;
                }
              } else {
                const errorText = await response.text();
                console.error(`❌ Failed to update ${contact.email}: ${response.status} - ${errorText}`);
                errorCount++;
              }
            } else {
              console.log(`⏭️  Already unsubscribed: ${contact.email}`);
              skippedCount++;
            }
          } else {
            // Status is SUBSCRIBED - need to unsubscribe
            const response = await unsubscribeFromEcomail(contact.email);

            if (response.ok) {
              // Validate response body - Ecomail might return 200 with error in body
              const result = await response.json();
              if (result.error) {
                console.error(`❌ API error unsubscribing ${contact.email}: ${JSON.stringify(result)}`);
                errorCount++;
              } else {
                console.log(`✅ Unsubscribed: ${contact.email}`);
                unsubscribedCount++;
              }
            } else {
              const errorText = await response.text();
              console.error(`❌ Failed to unsubscribe ${contact.email}: ${response.status} - ${errorText}`);
              errorCount++;
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error syncing ${contact.email}:`, error.message);
        errorCount++;
      }

      // Rate limiting: delay between requests to avoid overwhelming API (100ms = max 10 req/sec)
      await delay(100);
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Sync Summary:');
    console.log(`   Total contacts: ${pages.length}`);
    console.log(`   ✅ Subscribed/Updated: ${successCount}`);
    console.log(`   🚫 Unsubscribed: ${unsubscribedCount}`);
    console.log(`   ⏭️  Skipped (no changes): ${skippedCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log('='.repeat(50));

    // Exit with error code if there were failures
    if (errorCount > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the sync
main();
