const policyRevisionDateCompatMarker =
  'icoretech-vaultwarden-policy-revision-date-compat';

export function patchPolicyRevisionDate(source) {
  const className = 'class Policy extends Domain {';
  const classStart = source.indexOf(className);
  const classEnd = source.indexOf('\n}', classStart);
  if (
    classStart === -1 ||
    classEnd === -1 ||
    source.indexOf(className, classStart + className.length) !== -1
  ) {
    return { source, replacements: 0, valid: false };
  }

  const classSource = source.slice(classStart, classEnd + 2);
  const staticMethodStart = classSource.indexOf('\n    static fromResponse(');
  if (staticMethodStart === -1) {
    return { source, replacements: 0, valid: false };
  }

  const constructorSource = classSource.slice(0, staticMethodStart);
  const unpatchedMatches = [
    ...constructorSource.matchAll(
      /(^[ \t]*)this\.revisionDate = new Date\(obj\.revisionDate\);$/gm,
    ),
  ];
  const patchedMatches = [
    ...constructorSource.matchAll(
      /(^[ \t]*)\/\* icoretech-vaultwarden-policy-revision-date-compat \*\/\n\1this\.revisionDate = obj\.revisionDate == null\n\1 {4}\? undefined\n\1 {4}: new Date\(obj\.revisionDate\);$/gm,
    ),
  ];
  if (unpatchedMatches.length === 0 && patchedMatches.length === 1) {
    return { source, replacements: 0, valid: true };
  }

  const match = unpatchedMatches[0];
  if (
    unpatchedMatches.length !== 1 ||
    patchedMatches.length !== 0 ||
    typeof match?.index !== 'number'
  ) {
    return { source, replacements: 0, valid: false };
  }

  const indent = match[1] ?? '';
  const assignmentStart = classStart + match.index;
  const replacement = [
    `${indent}/* ${policyRevisionDateCompatMarker} */\n`,
    `${indent}this.revisionDate = obj.revisionDate == null\n`,
    `${indent}    ? undefined\n`,
    `${indent}    : new Date(obj.revisionDate);`,
  ].join('');
  return {
    source:
      source.slice(0, assignmentStart) +
      replacement +
      source.slice(assignmentStart + match[0].length),
    replacements: 1,
    valid: true,
  };
}
