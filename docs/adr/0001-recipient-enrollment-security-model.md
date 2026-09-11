# Recipient enrollment security model

A recipient must be able to use their own device without ever holding caretaker credentials, and a caretaker must be able to take that access away. We give every recipient a separate credential-free Better Auth identity, sign a device in through a caretaker-approved enrollment handshake, and gate every recipient request on an active-session reference stored next to the recipient profile. The alternative — reusing the caretaker's session on a shared device — cannot be revoked per device and exposes caretaker-only operations.

## Considered options

- **A second token system (custom JWT plus refresh tokens).** Rejected: it would duplicate session validation, expiry, and revocation that Better Auth already owns, and the two would drift.
- **An open anonymous sign-up route.** Rejected: anyone who reached the API could mint a recipient identity. Recipient identities are created only by an authenticated caretaker, and enrollment binds a device to one of them.
- **Trusting the Better Auth session alone for recipient requests.** Rejected: Better Auth has no notion of "the device this recipient currently uses". Storing `recipient.activeSessionId` makes replacement and revocation a single authoritative state change, and makes a session that exists but was never activated unusable.

## Consequences

- **Recipient identities carry a synthetic email.** Better Auth requires a unique email per user. Recipients get a server-generated address under the reserved `.invalid` domain, with no account row, no password, and no verification claim. It is an internal compatibility value and is never returned by the API.
- **The approved session token is stored until it is collected.** Approval activates the session immediately, so the token has to survive until the bound claimant collects it. It is held on the enrollment row and cleared when the short delivery window closes. Trading this off against creating the session at collection time was deliberate: activating at approval is what lets one state change both grant the new device and revoke the old one.
- **`/api/auth/*` is filtered for recipients.** The Better Auth handler surface is broad; a recipient device may only read its session or sign out, because account mutation or credential creation would become an alternate enrollment path.
- **Access checks read the database on every request.** No session or relationship caching, so revocation takes effect on the next request. A response already downloaded cannot be withdrawn; clearing device-side caches is a client responsibility.

## Migration implications

Migration `0005_add_recipients.sql` is additive: it adds `user.accountKind` (defaulting existing users to `caretaker`) and the `recipient`, `task_assignment`, and `enrollment` tables. Composite foreign keys keep a recipient and an assigned root task under the same caretaker, and a partial unique index allows at most one open enrollment per recipient.

Rolling back to a backend that predates this migration is not safe once recipient sessions exist: that backend treats every authenticated user as a caretaker, so a recipient device would gain caretaker access. Before any such rollback, disable recipient access and revoke recipient sessions, or roll forward with a fix.
