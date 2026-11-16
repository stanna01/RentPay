// Password rules, following NIST SP 800-63B: a minimum length (longer for
// super admins), a maximum that fits bcrypt, and a block-list of very common
// passwords. No forced complexity rules — length matters most.

export const MIN_LENGTH = { SUPER_ADMIN: 12, LANDLORD: 8 };
// bcrypt only uses the first 72 bytes; refuse longer so nothing is silently cut.
export const MAX_BYTES = 72;

// The most commonly used / breached passwords (lower-cased). Not exhaustive —
// it blocks the guesses an attacker tries first.
const COMMON = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345678910',
  '0123456789', '987654321', '11111111', '111111111', '00000000', '000000000',
  '12341234', '12121212', '11223344', '123123123', '123321123', '147258369',
  '159753456', '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', 'q1w2e3r4', 'qwer1234',
  'qwerty', 'qwerty12', 'qwerty123', 'qwerty1234', 'qwertyuiop', 'asdfghjkl',
  'asdf1234', 'zxcvbnm1', 'zaq12wsx', '1qaz2wsx', '1qaz2wsx3edc', 'qazwsxedc',
  'password', 'password1', 'password12', 'password123', 'password1234', 'password!',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'pa$$word', 'passwort', 'motdepasse',
  'iloveyou', 'iloveyou1', 'iloveyou2', 'princess', 'princess1', 'sunshine',
  'sunshine1', 'football', 'football1', 'baseball', 'basketball', 'superman',
  'batman123', 'starwars', 'trustno1', 'welcome', 'welcome1', 'welcome123',
  'letmein', 'letmein1', 'letmein123', 'monkey123', 'dragon123', 'master123',
  'shadow123', 'michael1', 'jennifer', 'jordan23', 'liverpool', 'chelsea1',
  'arsenal1', 'manchester', 'computer', 'internet', 'whatever', 'changeme',
  'changeme1', 'changeme123', 'admin123', 'admin1234', 'administrator', 'adminadmin',
  'rootroot', 'root1234', 'test1234', 'testtest', 'guest123', 'default1',
  'secret123', 'abc12345', 'abcd1234', 'abcdefgh', 'aa123456', 'a1234567',
  'a12345678', 'Aa123456', 'qwe12345', 'zxcvbnm', 'asdfasdf', 'loveyou1',
  'babygirl', 'lovely123', 'samsung1', 'iphone123', 'google123', 'facebook',
  'rentreceipt', 'rentreceipt1', 'landlord', 'landlord1', 'landlord123',
  'zambia123', 'lusaka123', 'kwacha123',
].map((p) => p.toLowerCase()));

/**
 * Return a friendly reason why `password` is not acceptable, or null if it is.
 * @param {string} password
 * @param {{ email?: string, role?: string }} ctx
 */
export function passwordProblem(password, { email = '', role = 'LANDLORD' } = {}) {
  const pw = String(password ?? '');
  const min = MIN_LENGTH[role] || MIN_LENGTH.LANDLORD;
  if (pw.length < min) {
    return `Password must be at least ${min} characters.`;
  }
  if (Buffer.byteLength(pw, 'utf8') > MAX_BYTES) {
    return `Password is too long (maximum ${MAX_BYTES} characters).`;
  }
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) {
    return 'That password is too common and easy to guess. Please choose another.';
  }
  const e = String(email || '').toLowerCase();
  if (e && (lower === e || lower === e.split('@')[0])) {
    return 'Your password must not be your email address.';
  }
  if (/^(.)\1+$/.test(pw)) {
    return 'Your password must not be a single repeated character.';
  }
  return null;
}
