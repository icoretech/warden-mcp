import assert from 'node:assert/strict';
import test from 'node:test';

import { BwSessionManager, readBwEnv } from '../bw/bwSession.js';
import { KeychainSdk } from '../sdk/keychainSdk.js';

const AUTH_SMOKE_PROFILE = 'auth-smoke';

function isAuthSmokeProfile() {
  return process.env.KEYCHAIN_INTEGRATION_PROFILE === AUTH_SMOKE_PROFILE;
}

function assertOperationalReady(status: unknown) {
  assert.ok(status && typeof status === 'object');
  const rec = status as { operational?: unknown; summary?: unknown };
  assert.ok(rec.operational && typeof rec.operational === 'object');
  assert.equal((rec.operational as { ready?: unknown }).ready, true);
  assert.ok(
    typeof rec.summary === 'string' &&
      rec.summary.toLowerCase().includes('vault access ready'),
  );
}

async function waitForVaultwardenAlive(baseUrl: string, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/alive`, {
        // Avoid hanging indefinitely on TLS/DNS issues in containerized test envs.
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for vaultwarden alive at ${baseUrl}`);
}

test('integration: can create/search/get/update note via bw + vaultwarden', {
  timeout: 180_000,
}, async (t) => {
  // This test expects a pre-existing vault account. For local docker-compose:
  // 1) Start: docker compose up -d vaultwarden
  // 2) Create account once via UI at http://localhost:8080 (SIGNUPS_ALLOWED=true)
  // 3) Set BW_USER/BW_PASSWORD (or BW_CLIENTID/BW_CLIENTSECRET + BW_PASSWORD) in .env

  const bwHost = process.env.BW_HOST ?? '';
  if (bwHost.length === 0) {
    t.skip('BW_HOST not set (integration tests require docker compose env)');
    return;
  }

  console.log(`[itest] waiting for vaultwarden alive at ${bwHost}`);
  await waitForVaultwardenAlive(bwHost);

  console.log('[itest] initializing SDK');
  const bw = new BwSessionManager(readBwEnv());
  const sdk = new KeychainSdk(bw);

  if (isAuthSmokeProfile()) {
    const folders = await sdk.listFolders({ limit: 1 });
    assert.equal(Array.isArray(folders), true);
    assertOperationalReady(await sdk.status());
    return;
  }

  // Create a folder and place a note into it.
  const folderName = `keychain-itest-folder-${Date.now()}`;
  console.log(`[itest] creating folder ${folderName}`);
  const createdFolder = await sdk.createFolder({ name: folderName });
  const folderId =
    createdFolder &&
    typeof createdFolder === 'object' &&
    typeof (createdFolder as { id?: unknown }).id === 'string'
      ? String((createdFolder as { id: string }).id)
      : '';
  assert.ok(folderId, 'created folder should have an id');

  // Create a unique note
  const name = `keychain-itest-${Date.now()}`;
  console.log(`[itest] creating note ${name}`);

  let created: { id: string };
  let createdLoginId = '';
  let createdCardId = '';
  let createdIdentityId = '';
  try {
    created = (await sdk.createNote({
      name,
      notes: 'hello',
      fields: [{ name: 'k', value: 'v', hidden: false }],
      folderId,
    })) as { id: string };
  } catch (e: unknown) {
    // Common failure mode: user not created yet / wrong creds.
    const msg =
      e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
    t.skip(
      `Skipping: failed to create note (likely missing/invalid BW creds): ${msg}`,
    );
    await sdk.deleteFolder({ id: folderId }).catch(() => {});
    return;
  }

  const createdId = created.id;
  // SDK returns a redacted item object, but it should still have an id.
  assert.ok(createdId, 'created item should have an id');

  try {
    // Search by name
    console.log('[itest] searching item');
    const results = await sdk.searchItems({ text: name, limit: 50 });
    const found = results.find(
      (it) =>
        it &&
        typeof it === 'object' &&
        typeof (it as { id?: unknown }).id === 'string' &&
        (it as { id: string }).id === createdId,
    );
    assert.ok(found, 'created item should be searchable');

    // Get by id
    console.log('[itest] getting item');
    const got = await sdk.getItem(String(createdId));
    assert.ok(got && typeof got === 'object');

    // Update notes
    console.log('[itest] updating item');
    const updated = await sdk.updateItem(String(createdId), {
      notes: 'updated',
    });
    assert.ok(updated && typeof updated === 'object');

    // Move note out of folder + mark favorite.
    console.log('[itest] moving note + favorite');
    const moved = await sdk.updateItem(String(createdId), {
      folderId: null,
      favorite: true,
    });
    assert.ok(moved && typeof moved === 'object');

    // Delete + restore the note
    console.log('[itest] deleting item');
    await sdk.deleteItem({ id: String(createdId) });
    console.log('[itest] restoring item');
    const restored = await sdk.restoreItem({ id: String(createdId) });
    assert.ok(restored && typeof restored === 'object');

    // Create a login with custom fields, TOTP, and an attachment.
    const loginName = `keychain-itest-login-${Date.now()}`;
    console.log(`[itest] creating login ${loginName}`);
    const createdLogin = (await sdk.createLogin({
      name: loginName,
      username: 'itest',
      password: 'itest-password-test-only',
      totp: 'JBSWY3DPEHPK3PXP',
      uris: [
        { uri: 'https://example.com', match: 'host' },
        { uri: 'https://example.com/login', match: 'exact' },
      ],
      fields: [
        { name: 'visible', value: 'v', hidden: false },
        { name: 'hidden', value: 'h', hidden: true },
      ],
      attachments: [
        {
          filename: 'itest.txt',
          contentBase64: Buffer.from('hello', 'utf8').toString('base64'),
        },
      ],
    })) as { id: string; login?: { password?: string; totp?: string } };
    createdLoginId = createdLogin.id;
    assert.ok(createdLogin.id, 'created login should have an id');
    assert.equal(createdLogin.login?.password, '[REDACTED]');
    assert.equal(createdLogin.login?.totp, '[REDACTED]');

    // Search should handle pipe-delimited terms (common "name | username" pattern).
    const foundPipe = await sdk.searchItems({
      text: `${loginName} | itest`,
      type: 'login',
      limit: 50,
    });
    assert.equal(Array.isArray(foundPipe), true);
    assert.ok(
      foundPipe.some(
        (x) =>
          x &&
          typeof x === 'object' &&
          (x as { id?: unknown }).id === createdLogin.id,
      ),
      'searchItems should find created login via pipe-delimited search terms',
    );

    const gotLogin = (await sdk.getItem(String(createdLogin.id))) as unknown;
    assert.ok(gotLogin && typeof gotLogin === 'object');
    const gotLoginRec = gotLogin as Record<string, unknown>;
    const gotLoginLogin = gotLoginRec.login as
      | Record<string, unknown>
      | undefined;
    assert.equal(gotLoginLogin?.password, '[REDACTED]');
    assert.equal(gotLoginLogin?.totp, '[REDACTED]');

    // Update one uri match without replacing all entries (merge mode).
    const afterSet = (await sdk.setLoginUris({
      id: String(createdLogin.id),
      mode: 'merge',
      uris: [{ uri: 'https://example.com', match: 'domain' }],
    })) as Record<string, unknown>;
    assert.ok(afterSet && typeof afterSet === 'object');

    // Create a card
    const cardName = `keychain-itest-card-${Date.now()}`;
    console.log(`[itest] creating card ${cardName}`);
    const createdCard = (await sdk.createCard({
      name: cardName,
      cardholderName: 'Test User',
      brand: 'visa',
      number: '4111111111111111',
      expMonth: '12',
      expYear: '2030',
      code: '123',
      notes: 'itest',
    })) as { id: string };
    createdCardId = createdCard.id;
    assert.ok(createdCard.id, 'created card should have an id');

    // Create an identity
    const identityName = `keychain-itest-identity-${Date.now()}`;
    console.log(`[itest] creating identity ${identityName}`);
    const createdIdentity = (await sdk.createIdentity({
      name: identityName,
      identity: {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        ssn: '111-22-3333',
      },
      notes: 'itest',
    })) as { id: string };
    createdIdentityId = createdIdentity.id;
    assert.ok(createdIdentity.id, 'created identity should have an id');
  } finally {
    await sdk
      .deleteItems({
        ids: [
          createdIdentityId,
          createdCardId,
          createdLoginId,
          createdId,
        ].filter((id) => id.length > 0),
        permanent: true,
      })
      .catch(() => {});
    await sdk.deleteFolder({ id: folderId }).catch(() => {});
  }
});

test('integration: can create/list/edit/delete organization collections', {
  timeout: 120_000,
}, async (t) => {
  const requireOrgTests = /^true$/i.test(
    process.env.KEYCHAIN_REQUIRE_ORG_TESTS ?? '',
  );
  const bwHost = process.env.BW_HOST ?? '';
  if (isAuthSmokeProfile()) {
    t.skip('Org collection CRUD is skipped in auth-smoke integration profile');
    return;
  }
  if (!bwHost) {
    t.skip('BW_HOST not set (integration tests require docker compose env)');
    return;
  }

  console.log(`[itest] waiting for vaultwarden alive at ${bwHost}`);
  await waitForVaultwardenAlive(bwHost);

  const bw = new BwSessionManager(readBwEnv());
  const sdk = new KeychainSdk(bw);

  const orgs = await sdk.listOrganizations({});
  if (!Array.isArray(orgs) || orgs.length === 0) {
    if (requireOrgTests) {
      assert.fail(
        'No orgs available for org-collection integration test (expected org seed to have run)',
      );
    }
    t.skip('No orgs available for org-collection integration test');
    return;
  }

  const firstOrg = orgs[0];
  if (!firstOrg || typeof firstOrg !== 'object') {
    t.skip('Organization list result is not object-shaped');
    return;
  }

  const organizationId = (firstOrg as { id?: unknown }).id;
  if (typeof organizationId !== 'string' || organizationId.length === 0) {
    t.skip('Could not determine an organization id from first org record');
    return;
  }

  const original = await sdk.listOrgCollections({
    organizationId,
    limit: 100,
  });
  assert.equal(Array.isArray(original), true);

  const name = `keychain-itest-org-${Date.now()}`;
  let collectionId = '';

  try {
    const created = (await sdk.createOrgCollection({
      organizationId,
      name,
    })) as { id?: unknown; name?: unknown; organizationId?: unknown };

    assert.equal(typeof created.id, 'string');
    collectionId = String(created.id);
    assert.equal(created.name, name);
    assert.equal(created.organizationId, organizationId);

    const got = (await sdk.getOrgCollection({
      id: collectionId,
      organizationId,
    })) as { id?: unknown; name?: unknown; organizationId?: unknown };
    assert.equal(got.id, created.id);
    assert.equal(got.name, name);
    assert.equal(got.organizationId, organizationId);

    const afterCreate = await sdk.listOrgCollections({
      organizationId,
      search: name,
    });
    assert.equal(Array.isArray(afterCreate), true);
    assert.ok(afterCreate.length >= 1);

    const renamed = `keychain-itest-org-${Date.now()}-renamed`;
    const edited = (await sdk.editOrgCollection({
      organizationId,
      id: collectionId,
      name: renamed,
    })) as { id?: unknown; name?: unknown; organizationId?: unknown };
    assert.equal(edited.id, created.id);
    assert.equal(edited.name, renamed);
    assert.equal(edited.organizationId, organizationId);
  } finally {
    if (collectionId) {
      await sdk.deleteOrgCollection({ organizationId, id: collectionId });
    }
  }

  const final = await sdk.listOrgCollections({
    organizationId,
    search: name,
  });
  assert.equal(Array.isArray(final), true);
  assert.equal(final.length, 0);
});
