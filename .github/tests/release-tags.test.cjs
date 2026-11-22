const assert = require('node:assert/strict');
const test = require('node:test');
const { Manifest } = require('release-please');
const config = require('../../release-please-config.json');

const plugin = 'plugins/warden-mcp';
const previousSha = 'a'.repeat(40);
const sourceSha = 'b'.repeat(40);
const mergedSha = 'c'.repeat(40);
const serverFile = 'src/server.ts';
const pluginFile = `${plugin}/start.sh`;

for (const [name, files, expectedTags] of [
  ['server only', [serverFile], ['v1.2.4']],
  ['plugin only', [pluginFile], ['claude-plugin-v2.3.5']],
  [
    'server and plugin',
    [serverFile, pluginFile],
    ['claude-plugin-v2.3.5', 'v1.2.4'],
  ],
]) {
  test(`tags the merged release commit for ${name}`, async () => {
    const repositoryFiles = {
      'release-please-config.json': config,
      '.release-please-manifest.json': { '.': '1.2.3', [plugin]: '2.3.4' },
      'package.json': { name: '@example-org/sample-app', version: '1.2.3' },
    };
    let merged;
    const github = {
      repository: {
        owner: 'example-org',
        repo: 'sample-app',
        defaultBranch: 'main',
      },
      async getFileJson(file) {
        assert.ok(Object.hasOwn(repositoryFiles, file), file);
        return repositoryFiles[file];
      },
      async getFileContentsOnBranch(file) {
        return { parsedContent: JSON.stringify(await this.getFileJson(file)) };
      },
      async *releaseIterator() {
        for (const tagName of ['v1.2.3', 'claude-plugin-v2.3.4']) {
          yield { tagName, sha: previousSha };
        }
      },
      async *mergeCommitIterator() {
        yield { sha: sourceSha, message: 'fix: update runtime', files };
        yield { sha: previousSha, message: 'chore: release main', files: [] };
      },
      async *pullRequestIterator() {
        yield merged;
      },
    };

    const manifest = await Manifest.fromManifest(github, 'main');
    const requests = await manifest.buildPullRequests();
    assert.equal(requests.length, 1);
    const [pr] = requests;
    merged = {
      number: 1,
      sha: mergedSha,
      title: pr.title.toString(),
      headBranchName: pr.headRefName,
      body: pr.body.toString(),
      labels: pr.labels,
    };

    const releases = await manifest.buildReleases();
    assert.deepEqual(
      releases.map((release) => release.tag.toString()).sort(),
      expectedTags,
    );
    for (const release of releases) assert.equal(release.sha, mergedSha);
  });
}
