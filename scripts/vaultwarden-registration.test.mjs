import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

import { registerAccount } from './vaultwarden-registration.mjs';

function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture(t, mode, fields = 'start') {
  const loginRequested = gate();
  const loginReady = gate();
  const signupRequested = gate();
  const signupReady = gate();
  const html = `<!doctype html><html><body><script>
const mode = ${JSON.stringify(mode)};
const fields = ${JSON.stringify(fields)};
let created = 0;
async function render() {
  if (location.hash === '#/signup') {
    document.body.innerHTML = '';
    await fetch('/ready-signup');
    document.body.innerHTML = '<auth-registration-start><h1>Create account</h1><label>Email address<input id="email" type="email"></label><label>Name<input id="name" formcontrolname="name"></label><button id="continue">Continue</button></auth-registration-start>';
    document.querySelector('#continue').onclick = () => {
      if (mode === 'existing-redirect') { location.hash = '/login'; return; }
      if (mode === 'existing-error') { document.body.innerHTML = '<p>Account already exists</p>'; return; }
      const password = fields === 'start' ? 'masterPassword' : 'newPassword';
      const confirm = fields === 'start' ? 'retypeMasterPassword' : 'newPasswordConfirm';
      document.body.innerHTML = '<label>Master password<input formcontrolname="' + password + '" type="password"></label><label>Confirm password<input formcontrolname="' + confirm + '" type="password"></label><button id="create">Create account</button>';
      document.querySelector('#create').onclick = () => { created++; location.hash = '/login'; };
    };
    return;
  }
  document.body.innerHTML = '<label>Email address<input type="email"></label><button>Continue</button>';
  await fetch('/ready-login');
  const link = document.createElement('a');
  link.textContent = 'Create account';
  link.href = mode === 'wrong-route' ? '#/login' : '#/signup';
  document.body.append(link);
}
window.addEventListener('hashchange', render);
render();
</script></body></html>`;
  const server = createServer(async (req, res) => {
    if (req.url === '/ready-login') {
      loginRequested.release();
      await loginReady.promise;
      res.end('ready');
    } else if (req.url === '/ready-signup') {
      signupRequested.release();
      await signupReady.promise;
      res.end('ready');
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(2_000);
  page.setDefaultNavigationTimeout(2_000);
  t.after(async () => {
    loginReady.release();
    signupReady.release();
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    page,
    account: {
      baseUrl: `http://127.0.0.1:${address.port}`,
      email: 'user@example.com',
      password: 'example-master-password',
      name: 'Example User',
    },
    loginRequested,
    loginReady,
    signupRequested,
    signupReady,
  };
}

for (const fields of ['start', 'finish']) {
  test(`registration waits for delayed login and ${fields} signup forms`, {
    timeout: 10_000,
  }, async (t) => {
    const app = await fixture(t, 'new', fields);
    const registration = registerAccount(app.page, app.account);
    await app.loginRequested.promise;
    app.loginReady.release();
    await app.signupRequested.promise;
    app.signupReady.release();

    assert.equal(await registration, 'created');
    assert.equal(await app.page.evaluate(() => created), 1);
  });
}

for (const mode of ['existing-redirect', 'existing-error']) {
  test(`registration preserves an existing account through ${mode}`, {
    timeout: 10_000,
  }, async (t) => {
    const app = await fixture(t, mode);
    app.loginReady.release();
    app.signupReady.release();

    assert.equal(await registerAccount(app.page, app.account), 'existing');
    assert.equal(await app.page.evaluate(() => created), 0);
  });
}

test('a create-account action remaining on login cannot count as registration', {
  timeout: 10_000,
}, async (t) => {
  const app = await fixture(t, 'wrong-route');
  app.loginReady.release();
  app.signupReady.release();

  await assert.rejects(registerAccount(app.page, app.account), /Timeout/);
  assert.equal(await app.page.evaluate(() => created), 0);
});
