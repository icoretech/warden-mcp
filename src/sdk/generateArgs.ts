export type GenerateInput = {
  uppercase?: boolean;
  lowercase?: boolean;
  number?: boolean;
  special?: boolean;
  passphrase?: boolean;
  length?: number;
  words?: number;
  minNumber?: number;
  minSpecial?: number;
  separator?: string;
  capitalize?: boolean;
  includeNumber?: boolean;
  ambiguous?: boolean;
};

function hasOwn(o: object, k: string) {
  return Object.hasOwn(o, k);
}

/**
 * Build args for `bw --raw generate ...`.
 *
 * Defaults:
 * - If the caller does not specify any of {uppercase, lowercase, number, special},
 *   we do NOT pass charset flags and let `bw` use its defaults (`-uln --length 14`).
 * - If the caller specifies any charset flag, we treat unspecified flags as
 *   "UI defaults": uppercase/lowercase/number default to true; special defaults
 *   to false. This makes `{ special: true }` behave like "toggle special on".
 *
 * Note: `bw` doesn’t support explicit "disable numbers"; to exclude a charset you
 * omit that flag. We avoid accidentally triggering `bw` defaults by including
 * at least one charset flag when the user is in "explicit charset" mode.
 */
export function buildBwGenerateArgs(input: GenerateInput): string[] {
  const args: string[] = ['--raw', 'generate'];

  if (input.passphrase) {
    args.push('--passphrase');
    if (typeof input.words === 'number')
      args.push('--words', String(input.words));
    if (typeof input.separator === 'string')
      args.push('--separator', input.separator);
    if (input.capitalize) args.push('--capitalize');
    if (input.includeNumber) args.push('--includeNumber');
  } else {
    const hasUpper = hasOwn(input, 'uppercase');
    const hasLower = hasOwn(input, 'lowercase');
    const hasNumber = hasOwn(input, 'number');
    const hasSpecial = hasOwn(input, 'special');
    const explicitCharset = hasUpper || hasLower || hasNumber || hasSpecial;

    if (explicitCharset) {
      const uppercase = hasUpper ? input.uppercase === true : true;
      const lowercase = hasLower ? input.lowercase === true : true;
      const number = hasNumber ? input.number === true : true;
      const special = hasSpecial ? input.special === true : false;

      if (!uppercase && !lowercase && !number && !special) {
        throw new Error(
          'At least one of uppercase/lowercase/number/special must be true',
        );
      }

      if (uppercase) args.push('--uppercase');
      if (lowercase) args.push('--lowercase');
      if (number) args.push('--number');
      if (special) args.push('--special');
    }
  }

  if (typeof input.length === 'number')
    args.push('--length', String(input.length));
  if (typeof input.minNumber === 'number')
    args.push('--minNumber', String(input.minNumber));
  if (typeof input.minSpecial === 'number')
    args.push('--minSpecial', String(input.minSpecial));
  if (input.ambiguous) args.push('--ambiguous');

  return args;
}
