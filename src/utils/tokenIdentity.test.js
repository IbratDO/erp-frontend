/**
 * The check that stops the screen naming the wrong person.
 *
 * A shop assistant reads the sidebar to know who they are working as. If it can name somebody
 * else while the server treats them as themselves, every judgement they make from that point
 * rests on a false premise — and unlike an error message, a wrong name gives them no reason to
 * doubt it. So the profile must be provably the token's own before it reaches the screen.
 */
import { identityMatchesToken, tokenUserId } from './tokenIdentity';

/** A JWT is three base64url segments; only the middle one is read here. */
function tokenWith(claims) {
  const body = btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${body}.signature`;
}

describe('reading the user out of a token', () => {
  it('finds the claim SimpleJWT signs', () => {
    expect(tokenUserId(tokenWith({ user_id: 82, token_type: 'access' }))).toBe('82');
  });

  it('reads a numeric and a string id to the same value', () => {
    // The claim's JSON type has drifted between SimpleJWT versions; the comparison must not.
    expect(tokenUserId(tokenWith({ user_id: 82 }))).toBe(tokenUserId(tokenWith({ user_id: '82' })));
  });

  it('survives padding the base64url form drops', () => {
    // A body whose length is not a multiple of four throws in atob without the padding restored.
    [1, 12, 123, 1234, 12345].forEach((id) => {
      expect(tokenUserId(tokenWith({ user_id: id, jti: 'x'.repeat(id % 7) }))).toBe(String(id));
    });
  });

  it.each([
    ['not a token'],
    ['only.two'],
    ['header..signature'],
    ['header.!!!!.signature'],
    [''],
    [null],
    [undefined],
    [42],
  ])('reports %j as unreadable rather than throwing', (bad) => {
    expect(tokenUserId(bad)).toBeNull();
  });

  it('reports a token carrying no user_id as unreadable', () => {
    expect(tokenUserId(tokenWith({ token_type: 'access' }))).toBeNull();
  });
});

describe('matching a profile to the token being sent', () => {
  it('accepts the profile that belongs to the token', () => {
    expect(identityMatchesToken({ id: 82, username: 'admin' }, tokenWith({ user_id: 82 }))).toBe(true);
  });

  it('refuses somebody else', () => {
    // The reported bug, reduced: a token issued for user 82 and a profile describing user 7.
    const other = { id: 7, username: 'Ibrat' };
    expect(identityMatchesToken(other, tokenWith({ user_id: 82 }))).toBe(false);
  });

  it('does not care whether the ids are numbers or strings', () => {
    expect(identityMatchesToken({ id: '82' }, tokenWith({ user_id: 82 }))).toBe(true);
  });
});

describe('what it does when it cannot tell', () => {
  /**
   * This check exists to catch a mismatch, not to become a new way to lock the shop out. If the
   * backend ever renames or stops signing the claim, every user would fail a strict check at
   * once — an outage worse than the bug it guards. So it refuses only on a proven mismatch.
   */
  it('allows the profile when the token carries no claim', () => {
    expect(identityMatchesToken({ id: 82 }, tokenWith({ token_type: 'access' }))).toBe(true);
  });

  it('allows the profile when the token is unreadable', () => {
    expect(identityMatchesToken({ id: 82 }, 'garbage')).toBe(true);
  });

  it('allows the profile when there is no token at all', () => {
    expect(identityMatchesToken({ id: 82 }, null)).toBe(true);
  });

  it('allows a profile with no id', () => {
    expect(identityMatchesToken({ username: 'admin' }, tokenWith({ user_id: 82 }))).toBe(true);
  });

  it.each([[null], [undefined], [{}]])('allows %j rather than throwing', (profile) => {
    expect(identityMatchesToken(profile, tokenWith({ user_id: 82 }))).toBe(true);
  });
});
