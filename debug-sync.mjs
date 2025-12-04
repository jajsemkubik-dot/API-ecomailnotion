/**
 * Debug script to trace EXACTLY what happens during sync
 * This will show:
 * 1. What Notion returns for the Marketingový status field
 * 2. What Ecomail returns for the subscriber status
 * 3. What API call is being made
 * 4. What Ecomail responds with
 */

import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ECOMAIL_API_KEY = process.env.ECOMAIL_API_KEY;
const ECOMAIL_LIST_ID = process.env.ECOMAIL_LIST_ID;

console.log('🔍 DEBUG SYNC - Tracing exact behavior\n');
console.log('='.repeat(70));

// Validate env vars
if (!NOTION_TOKEN || !NOTION_DATABASE_ID || !ECOMAIL_API_KEY || !ECOMAIL_LIST_ID) {
    console.error('❌ Missing environment variables');
    process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// Status codes
const ECOMAIL_STATUS = {
    SUBSCRIBED: 1,
    UNSUBSCRIBED: 2,
    HARD_BOUNCE: 4,
    SPAM_COMPLAINT: 5,
    UNCONFIRMED: 6
};

async function main() {
    try {
        // Step 1: Get first few contacts from Notion
        console.log('\n📖 STEP 1: Fetching contacts from Notion...\n');

        const notionResponse = await notion.databases.query({
            database_id: NOTION_DATABASE_ID,
            page_size: 5
        });

        console.log(`Found ${notionResponse.results.length} contacts\n`);

        for (const page of notionResponse.results) {
            const props = page.properties;
            const email = props.Email?.email;

            if (!email) {
                console.log('⚠️  Contact without email, skipping\n');
                continue;
            }

            console.log('─'.repeat(70));
            console.log(`📧 EMAIL: ${email}`);
            console.log('─'.repeat(70));

            // Step 2: Show EXACT Notion property structure
            console.log('\n📋 NOTION DATA:');

            // Check all property names for anything related to marketing/subscribe
            const allPropNames = Object.keys(props);
            console.log(`   All properties: ${allPropNames.join(', ')}`);

            // Look for marketing status with different possible names
            const possibleNames = ['Marketingový status', 'Marketingovy status', 'Marketing status', 'Subscribe', 'Status'];
            let foundProp = null;
            let foundPropName = null;

            for (const name of possibleNames) {
                if (props[name]) {
                    foundProp = props[name];
                    foundPropName = name;
                    break;
                }
            }

            // Also try normalized search
            if (!foundProp) {
                const normalizedTarget = 'Marketingový status'.normalize('NFC').toLowerCase();
                for (const propName of allPropNames) {
                    if (propName.normalize('NFC').toLowerCase() === normalizedTarget) {
                        foundProp = props[propName];
                        foundPropName = propName;
                        break;
                    }
                }
            }

            if (foundProp) {
                console.log(`   Found property: "${foundPropName}"`);
                console.log(`   Property type: ${foundProp.type}`);
                console.log(`   Raw value: ${JSON.stringify(foundProp, null, 2)}`);

                if (foundProp.type === 'select') {
                    const selectValue = foundProp.select?.name;
                    console.log(`   Select value: "${selectValue}"`);
                    console.log(`   Is "Ano": ${selectValue === 'Ano'}`);
                    console.log(`   Is "Ne": ${selectValue === 'Ne'}`);
                } else if (foundProp.type === 'checkbox') {
                    console.log(`   Checkbox value: ${foundProp.checkbox}`);
                } else if (foundProp.type === 'status') {
                    console.log(`   Status value: "${foundProp.status?.name}"`);
                }
            } else {
                console.log(`   ❌ NO MARKETING/SUBSCRIBE PROPERTY FOUND!`);
                console.log(`   Available properties:`);
                for (const propName of allPropNames) {
                    console.log(`      - "${propName}" (${props[propName].type})`);
                }
            }

            // Step 3: Check current Ecomail status
            console.log('\n📬 ECOMAIL DATA:');

            const ecomailUrl = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscriber/${encodeURIComponent(email)}`;
            console.log(`   Fetching: ${ecomailUrl}`);

            const ecomailResponse = await fetch(ecomailUrl, {
                method: 'GET',
                headers: {
                    'key': ECOMAIL_API_KEY,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`   Response status: ${ecomailResponse.status} ${ecomailResponse.statusText}`);

            if (ecomailResponse.ok) {
                const ecomailData = await ecomailResponse.json();
                console.log(`   Subscriber exists: YES`);
                console.log(`   Current status: ${ecomailData.status} (type: ${typeof ecomailData.status})`);
                console.log(`   Status meaning: ${ecomailData.status === 1 ? 'SUBSCRIBED' : ecomailData.status === 2 ? 'UNSUBSCRIBED' : 'OTHER'}`);
                console.log(`   Full data: ${JSON.stringify(ecomailData, null, 2)}`);

                // Step 4: Test what would happen if we try to subscribe
                if (foundProp && foundProp.select?.name === 'Ano' && ecomailData.status !== 1) {
                    console.log('\n🧪 TEST: Attempting to subscribe (Notion = Ano, Ecomail ≠ subscribed)...');

                    const subscribeUrl = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscribe`;
                    const payload = {
                        subscriber_data: {
                            email: email,
                            status: 1
                        },
                        update_existing: true,
                        resubscribe: true,
                        trigger_autoresponders: false,
                        skip_confirmation: true
                    };

                    console.log(`   POST ${subscribeUrl}`);
                    console.log(`   Payload: ${JSON.stringify(payload, null, 2)}`);

                    const subscribeResponse = await fetch(subscribeUrl, {
                        method: 'POST',
                        headers: {
                            'key': ECOMAIL_API_KEY,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    });

                    console.log(`   Response status: ${subscribeResponse.status}`);
                    const subscribeResult = await subscribeResponse.text();
                    console.log(`   Response body: ${subscribeResult}`);

                    // Verify the status changed
                    console.log('\n   🔄 Verifying status change...');
                    const verifyResponse = await fetch(ecomailUrl, {
                        method: 'GET',
                        headers: {
                            'key': ECOMAIL_API_KEY,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (verifyResponse.ok) {
                        const verifyData = await verifyResponse.json();
                        console.log(`   New status: ${verifyData.status} (${verifyData.status === 1 ? 'SUBSCRIBED ✅' : 'NOT SUBSCRIBED ❌'})`);

                        if (verifyData.status !== 1) {
                            console.log('\n   ⚠️  STATUS DID NOT CHANGE! This is the bug.');
                            console.log('   Possible causes:');
                            console.log('   - API requires different parameters');
                            console.log('   - Subscriber is hard bounced or spam complained');
                            console.log('   - API key lacks permission');
                        }
                    }
                }

            } else if (ecomailResponse.status === 404) {
                console.log(`   Subscriber exists: NO (not in list)`);
            } else {
                const errorText = await ecomailResponse.text();
                console.log(`   Error: ${errorText}`);
            }

            console.log('\n');
        }

        console.log('='.repeat(70));
        console.log('✅ Debug complete');
        console.log('\nLook for:');
        console.log('1. Is the Marketingový status property found correctly?');
        console.log('2. What value does it have (Ano/Ne)?');
        console.log('3. What is the current Ecomail status?');
        console.log('4. If test subscribe was attempted, did the status change?');

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

main();
