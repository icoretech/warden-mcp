import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const unpatchedMethod = `    setAccountCryptographicState(response, userId) {
        return login_strategy_awaiter(this, void 0, void 0, function* () {
            yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
        });
    }
`;

const policyConstructor = `class Policy extends Domain {
    constructor(obj) {
        super();
        if (obj == null) {
            return;
        }
        this.revisionDate = new Date(obj.revisionDate);
    }
    static fromResponse(response) {
        return new Policy(response);
    }
}
`;

const patchedPolicyConstructor = policyConstructor.replace(
  '        this.revisionDate = new Date(obj.revisionDate);',
  `        /* icoretech-vaultwarden-policy-revision-date-compat */
        this.revisionDate = obj.revisionDate == null
            ? undefined
            : new Date(obj.revisionDate);`,
);

const sampleBwSource = `${unpatchedMethod}${policyConstructor}`;

async function loadPatchLibModule() {
  const modulePath = pathToFileURL(
    resolve(process.cwd(), 'bin/patch-bitwarden-cli-lib.js'),
  ).href;
  return import(`${modulePath}?policy-test=${Date.now()}`);
}

test('patchBundledBwSource preserves missing Vaultwarden policy revision dates', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const result = patchBundledBwSource(sampleBwSource);

  assert.equal(result.replacements, 2);
  assert.match(
    result.source,
    /icoretech-vaultwarden-policy-revision-date-compat/,
  );
  assert.match(
    result.source,
    /this\.revisionDate = obj\.revisionDate == null\n\s+\? undefined\n\s+: new Date\(obj\.revisionDate\);/,
  );
});

test('patchBundledBwSource does not patch a policy date outside Policy', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const policyWithoutRevisionDate = policyConstructor.replace(
    '        this.revisionDate = new Date(obj.revisionDate);\n',
    '',
  );
  const unrelatedDateConstructor = `class UnrelatedRecord {
    constructor(obj) {
        this.revisionDate = new Date(obj.revisionDate);
    }
}
`;
  const source = sampleBwSource.replace(
    policyConstructor,
    `${policyWithoutRevisionDate}${unrelatedDateConstructor}`,
  );

  assert.throws(
    () => patchBundledBwSource(source),
    /could not locate every expected Vaultwarden compatibility block/,
  );
});

test('patchBundledBwSource does not use a later class static method as the Policy boundary', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const policyWithoutStaticMethod = policyConstructor.replace(
    / {4}static fromResponse\(response\) \{\n {8}return new Policy\(response\);\n {4}\}\n/,
    '',
  );
  const unrelatedClass = `class UnrelatedRecord {
    constructor(obj) {
        this.revisionDate = new Date(obj.revisionDate);
    }
    static fromResponse(response) {
        return new UnrelatedRecord(response);
    }
}
`;

  assert.throws(
    () =>
      patchBundledBwSource(
        sampleBwSource.replace(
          policyConstructor,
          `${policyWithoutStaticMethod}${unrelatedClass}`,
        ),
      ),
    /could not locate every expected Vaultwarden compatibility block/,
  );
});

test('patchBundledBwSource rejects a malformed policy compatibility block', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const malformedPolicyConstructor = policyConstructor.replace(
    '        this.revisionDate = new Date(obj.revisionDate);',
    `        /* icoretech-vaultwarden-policy-revision-date-compat */
        this.revisionDate = obj.revisionDate == null
            ? undefined
            : new Date();`,
  );

  assert.throws(
    () =>
      patchBundledBwSource(
        sampleBwSource.replace(policyConstructor, malformedPolicyConstructor),
      ),
    /could not locate every expected Vaultwarden compatibility block/,
  );
});

test('patchBundledBwSource patches policy dates when login compat already exists', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const fullyPatched = patchBundledBwSource(sampleBwSource).source;
  const policyUnpatched = fullyPatched.replace(
    /\s*\/\* icoretech-vaultwarden-policy-revision-date-compat \*\/\n\s*this\.revisionDate = obj\.revisionDate == null\n\s*\? undefined\n\s*: new Date\(obj\.revisionDate\);/,
    '\n        this.revisionDate = new Date(obj.revisionDate);',
  );
  const result = patchBundledBwSource(policyUnpatched);

  assert.equal(result.replacements, 1);
  assert.match(
    result.source,
    /icoretech-vaultwarden-policy-revision-date-compat/,
  );
});

test('patchBundledBwSource patches login compat when policy date is already safe', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const result = patchBundledBwSource(
    `${unpatchedMethod}${patchedPolicyConstructor}`,
  );

  assert.equal(result.replacements, 1);
  assert.match(result.source, /icoretech-vaultwarden-compat/);
});

test('patchBundledBwSource rejects a bare login compatibility marker', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const malformedLogin = `/* icoretech-vaultwarden-compat */
unsupportedLoginShape();
${patchedPolicyConstructor}`;

  assert.throws(
    () => patchBundledBwSource(malformedLogin),
    /could not locate every expected Vaultwarden compatibility block/,
  );
});

test('patchBundledBwSource does not patch an unrelated guarded key block', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const unrelatedGuard = `function unrelated(response, userId) {
    if (response.accountKeysResponseModel) {
        yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
    }
}
`;

  assert.throws(
    () => patchBundledBwSource(`${unrelatedGuard}${patchedPolicyConstructor}`),
    /could not locate every expected Vaultwarden compatibility block/,
  );
});

test('patchBundledBwSource rejects trailing code on the direct login state line', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const driftedLogin = unpatchedMethod.replace(
    'userId);',
    'userId); preserveThisSideEffect();',
  );

  assert.throws(
    () => patchBundledBwSource(`${driftedLogin}${patchedPolicyConstructor}`),
    /could not locate every expected Vaultwarden compatibility block/,
  );
});

test('patchBundledBwSource rejects trailing code on the guarded login block', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const guardedLogin = unpatchedMethod.replace(
    '            yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);',
    `            if (response.accountKeysResponseModel) {
                yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
            } preserveThisSideEffect();`,
  );

  assert.throws(
    () => patchBundledBwSource(`${guardedLogin}${patchedPolicyConstructor}`),
    /could not locate every expected Vaultwarden compatibility block/,
  );
});

test('patchBundledBwSource does not cross into a later generator method', async () => {
  const { patchBundledBwSource } = await loadPatchLibModule();
  const driftedMethod = `    setAccountCryptographicState(response, userId) {
        unsupportedNewImplementation();
    }
    unrelated(response, userId) {
        return unrelated_awaiter(this, void 0, void 0, function* () {
            yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);
        });
    }
`;

  assert.throws(
    () => patchBundledBwSource(`${driftedMethod}${patchedPolicyConstructor}`),
    /could not locate every expected Vaultwarden compatibility block/,
  );
});
