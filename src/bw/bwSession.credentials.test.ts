import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { BwCredentialError, BwSessionManager } from './bwSession.js';
import { sessionFixture } from './bwSession.lifecycle.fixture.js';

test('credential provider is lazy and shared by concurrent session callers', async (t) => {
  const fixture = await sessionFixture(t);
  let calls = 0;
  const manager = new BwSessionManager(fixture.config, {
    credentialProvider: async () => {
      calls += 1;
      return fixture.credentials;
    },
    persistSession: false,
  });
  assert.equal(calls, 0);

  const sessions = await Promise.all([
    manager.withSession(async (session) => session),
    manager.withSession(async (session) => session),
  ]);

  assert.deepEqual(sessions, ['session-1', 'session-1']);
  assert.equal(calls, 1);
});

for (const persistSession of [true, false]) {
  test(`provider status and keepalive never request credentials with persistence ${persistSession}`, async (t) => {
    const fixture = await sessionFixture(t);
    let calls = 0;
    const manager = new BwSessionManager(fixture.config, {
      credentialProvider: () => {
        calls += 1;
        return fixture.credentials;
      },
      persistSession,
    });

    manager.startKeepUnlocked();
    await manager.status();
    await setImmediate();
    await manager.status();

    assert.equal(calls, 0);
    assert.equal(await fixture.counter('unlocks'), 0);
  });
}

for (const mismatch of ['host', 'user', 'method', 'clientId'] as const) {
  test(`credential provider rejects a different ${mismatch} before authentication`, async (t) => {
    const fixture = await sessionFixture(t);
    const config =
      mismatch === 'clientId'
        ? {
            ...fixture.config,
            login: { method: 'apikey' as const, clientId: 'client.example' },
          }
        : fixture.config;
    const credentials =
      mismatch === 'host'
        ? { ...fixture.credentials, host: 'https://other.example.test' }
        : mismatch === 'user'
          ? {
              ...fixture.credentials,
              login: {
                method: 'userpass' as const,
                user: 'other@example.test',
              },
            }
          : {
              ...fixture.credentials,
              login: {
                method: 'apikey' as const,
                clientId: 'other-client',
                clientSecret: 'api-secret',
              },
            };
    const manager = new BwSessionManager(config, {
      credentialProvider: () => credentials,
      persistSession: false,
    });

    await assert.rejects(
      manager.withSession(async () => undefined),
      (error: unknown) => {
        assert.ok(error instanceof BwCredentialError);
        assert.equal('cause' in error, false);
        assert.doesNotMatch(
          error.message,
          /other-client|other@example|api-secret|master-password/,
        );
        return true;
      },
    );

    assert.equal(await fixture.counter('unlocks'), 0);
  });
}

for (const thrown of [
  new Error('private provider detail'),
  'private provider detail',
]) {
  test(`credential provider failure is sanitized when throwing ${typeof thrown}`, async (t) => {
    const fixture = await sessionFixture(t);
    const manager = new BwSessionManager(fixture.config, {
      credentialProvider: () => {
        throw thrown;
      },
    });

    await assert.rejects(
      manager.withSession(async () => undefined),
      (error: unknown) => {
        assert.ok(error instanceof BwCredentialError);
        assert.equal('cause' in error, false);
        assert.doesNotMatch(error.message, /private provider detail/);
        return true;
      },
    );
  });
}

test('API credentials are loaded once through login and unlock', async (t) => {
  const fixture = await sessionFixture(t);
  await fixture.write('require-login', 'yes');
  const config = {
    ...fixture.config,
    login: { method: 'apikey' as const, clientId: 'client.example' },
  };
  let calls = 0;
  const manager = new BwSessionManager(config, {
    credentialProvider: () => {
      calls += 1;
      return {
        ...config,
        password: 'master-password',
        login: { ...config.login, clientSecret: 'api-secret' },
      };
    },
    persistSession: false,
  });

  const session = await manager.withSession(async (value) => value);

  assert.equal(session, 'session-1');
  assert.equal(calls, 1);
});

test('full configuration uses provider credentials instead of retained static values', async (t) => {
  const fixture = await sessionFixture(t);
  const manager = new BwSessionManager(
    { ...fixture.credentials, password: 'obsolete-password' },
    {
      credentialProvider: () => fixture.credentials,
      persistSession: false,
    },
  );

  const session = await manager.withSession(async (value) => value);

  assert.equal(session, 'session-1');
});
