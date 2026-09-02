/**
 * Does the profile on screen belong to the token we are sending?
 *
 * The name in the sidebar and the powers the server grants come from two different places. The
 * server decides what you may do from the access token on each request; the screen shows the
 * body of one `/api/users/me/` call made once at login. Nothing checked that the two agreed —
 * so a stale, cached or misrouted profile response would put another person's name and role in
 * front of an operator who is in fact working as themselves. They would read the screen, believe
 * it, and act on it.
 *
 * The token already carries the answer. SimpleJWT signs `user_id` into every access token, and
 * `/users/me/` returns `id`. If those two disagree, the profile is not ours and must not be
 * shown. Comparing them costs nothing and turns a silent wrong identity into a refused login.
 *
 * The claim is only read, never trusted for authority — a browser cannot verify the signature
 * and must not try. Authority stays entirely with the server, which checks the signature on
 * every request. This is a consistency check on what we *display*.
 */

/** The `user_id` claim, as a string. Null when the token is absent or unreadable. */
export function tokenUserId(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // JWT uses base64url; atob wants standard base64, so restore the two swapped characters
    // and the stripped padding before decoding.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    const id = claims?.user_id;
    if (id === undefined || id === null || id === '') return null;
    return String(id);
  } catch {
    // A malformed token is the server's problem, not ours to interpret. Reporting "unreadable"
    // lets the caller fall through to its normal handling.
    return null;
  }
}

/**
 * True when this profile may be shown to whoever holds this token.
 *
 * **Fails open when the claim cannot be read**, and only then. If a future backend renames the
 * claim or stops signing it, every user in the shop would be locked out at once by a check that
 * was only ever meant to catch a mismatch — an outage far worse than the bug. So the rule is
 * narrow: refuse only when both ids are present and they differ.
 */
export function identityMatchesToken(profile, token) {
  const claimed = tokenUserId(token);
  if (claimed === null) return true;
  const actual = profile?.id;
  if (actual === undefined || actual === null || actual === '') return true;
  return String(actual) === claimed;
}
