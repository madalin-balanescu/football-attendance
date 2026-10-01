# Retrieving registrations in the same browser

After each successful signup, the attendance page saves that submission's private
management link before resetting the form or updating the roster. Every submission
is retained, including submissions made for other players. Existing saved links
continue to work. The attendance and management pages share the same storage code.

Open **Vezi jucătorii înscriși** or **Înscrieri salvate** to view registrations for
the selected Friday or Wednesday match. Each player has a separate withdrawal
action and still requires the original submission token and explicit confirmation.
The server verifies tokens against stored hashes; player names, cookies, and IP
addresses do not establish ownership.

## Storage and network changes

- **Local storage:** registrations survive page reloads, navigating away, and
  closing and reopening the browser on the same site and browser profile.
- **Tab fallback:** when local storage fails (including quota or access errors),
  session storage retains the links across reloads and navigation in that tab.
  Copy the private links before closing the tab.
- **Memory fallback:** when both storage options fail, the current page retains
  all links and displays a separate private link for each submission, opening it
  in a new tab to keep the original page's links available. Copy these
  links before leaving or reloading the page. The page explains this limitation.

Switching from Wi-Fi to mobile data, changing IPv4/IPv6 addresses, or expiring an
admin session does not change registration ownership. IP-based abuse limits still
apply independently. A temporary network failure preserves saved links and the
management page retries when the browser reports it is online again. A connection
is required to load current player status or submit a withdrawal; an offline roster
is a last-known snapshot.

Only a confirmed `404` when retrieving a submission removes an expired saved link.
Other failures leave it available for retry. Withdrawing a player keeps the link
and any other players in the same submission accessible.
The tab fallback merges submissions subsequently saved by other tabs, while
remembering expired links so an older local copy cannot bring them back.

Private tokens are stored only in the registration-link store, never in new public
dashboard cache snapshots. The management API and its responses remain uncached.
The PWA shell includes the shared storage script and updated page scripts.

## Recovery and limits

Storage belongs to the browser profile and site origin, not the physical device.
Another browser, an in-app browser, a private window, or an installed app with
separate storage may have a different set of saved links. Opening an original
private link there saves that submission for future use in that browser.

Clearing site data or closing a private browsing session can erase saved access.
Keep a copy of the private links if you need recovery or access on another device.
A combined management-page URL contains no tokens and cannot transfer ownership.
Previously lost links cannot be reconstructed from names or an IP address; an
organizer must manage those entries if no private link remains.

Browser storage cannot preserve registrations deleted from the server database.
On the temporary Render SQLite deployment, keep using the documented backup and
restore workflow; persistent PostgreSQL is needed for server-side durability.

## Verification

The backend suite checks retrieval and withdrawal from different IPv4/IPv6
addresses without a session cookie. Frontend regression tests cover multiple
submissions and players for both events, fresh-page retrieval and token-scoped
withdrawal, blocked storage, quota failures, tab fallback, memory-only links,
expired-link cleanup, shared-link saving, reconnect retries, and updates from
other tabs.

```bash
python3 -Wd -m unittest discover -s tests -v
node --test tests/test_*.js
```
