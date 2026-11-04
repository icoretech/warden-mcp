export class VaultwardenRegistrationError extends Error {
  constructor(stage) {
    super(`Vaultwarden registration did not complete (${stage})`);
    this.name = 'VaultwardenRegistrationError';
    this.stage = stage;
  }
}

const registrationRoute = /#\/(signup|register)\b/;
const loginRoute = /#\/login\b/;
const existingAccountText =
  /already (in use|exists)|email.*taken|account.*exists/i;

export async function registerAccount(page, account) {
  await page.goto(`${account.baseUrl}/#/login`, {
    waitUntil: 'domcontentloaded',
  });
  const createAccount = page
    .getByRole('link', { name: /create (an )?account|register|sign up/i })
    .or(
      page.getByRole('button', {
        name: /create (an )?account|register|sign up/i,
      }),
    )
    .first();
  await createAccount.click();
  await page.waitForURL(registrationRoute);
  const registrationForm = page
    .locator(
      'auth-registration-start, auth-registration-finish, input[formcontrolname="name"], input[formcontrolname="retypeMasterPassword"], input[formcontrolname="newPasswordConfirm"]',
    )
    .or(
      page.getByRole('heading', {
        name: /create (an )?account|register|sign up/i,
      }),
    )
    .first();
  await registrationForm.waitFor({ state: 'visible' });
  await page.getByLabel(/email address/i).fill(account.email);
  const name = page.getByLabel(/^name$/i);
  if (await name.isVisible()) await name.fill(account.name);
  await page.getByRole('button', { name: /^continue$/i }).click();

  const password = page.locator(
    'input[formcontrolname="masterPassword"], input[formcontrolname="newPassword"]',
  );
  const existing = page.getByText(existingAccountText).first();
  await Promise.any([
    password.first().waitFor({ state: 'visible' }),
    existing.waitFor({ state: 'visible' }),
    page.waitForURL(loginRoute),
  ]).catch(() => {
    throw new VaultwardenRegistrationError('identity');
  });
  if (loginRoute.test(page.url()) || (await existing.isVisible())) {
    return 'existing';
  }

  await password.first().fill(account.password);
  await page
    .locator(
      'input[formcontrolname="retypeMasterPassword"], input[formcontrolname="newPasswordConfirm"]',
    )
    .first()
    .fill(account.password);
  const breachCheck = page.getByRole('checkbox', {
    name: /check known data breaches/i,
  });
  if (await breachCheck.isVisible()) await breachCheck.uncheck();
  await page.getByRole('button', { name: /create account/i }).click();
  await Promise.any([
    page.waitForURL(/#\/(login|vault|home|setup-extension)\b/),
    existing.waitFor({ state: 'visible' }),
  ]).catch(() => {
    throw new VaultwardenRegistrationError('create');
  });
  return (await existing.isVisible()) ? 'existing' : 'created';
}
