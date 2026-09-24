import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

for (const directoryPrefix of ['warden-cli-', 'warden cli # %-']) {
  test(`stdio CLI initializes from ${directoryPrefix}`, {
    timeout: 15_000,
  }, async (t) => {
    // Given a built package installed at a real filesystem path.
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await mkdtemp(join(tmpdir(), directoryPrefix));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await cp(join(projectRoot, 'bin'), join(directory, 'bin'), {
      recursive: true,
    });
    await cp(join(projectRoot, 'dist'), join(directory, 'dist'), {
      recursive: true,
    });
    await cp(
      join(projectRoot, 'package.json'),
      join(directory, 'package.json'),
    );
    // Junctions work on Windows without requiring symbolic-link privileges.
    await symlink(
      join(projectRoot, 'node_modules'),
      join(directory, 'node_modules'),
      'junction',
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(directory, 'bin', 'warden-mcp.js'), '--stdio'],
      cwd: directory,
      env: {
        BW_HOST: 'https://example.test',
        BW_USER: 'user@example.test',
        BW_PASSWORD: 'test-password',
        KEYCHAIN_BW_HOME_ROOT: join(directory, 'bw-profiles'),
      },
      stderr: 'pipe',
    });
    const client = new Client(
      { name: 'cli-path-test', version: '0.0.0' },
      { capabilities: {} },
    );
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // When the actual CLI handles initialize and tools/list over stdio.
    try {
      await client.connect(transport);
      const result = await client.listTools();

      // Then the server advertises its tools without needing a vault login.
      assert.ok(result.tools.some((tool) => tool.name === 'keychain_status'));
      assert.equal(stderr, '');
    } catch (error) {
      throw new Error(`CLI handshake failed; stderr: ${stderr}`, {
        cause: error,
      });
    } finally {
      // Close the process before removing its working directory on Windows.
      await client.close();
    }
  });
}
