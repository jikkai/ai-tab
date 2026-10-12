# Data and permissions

AI Tab has no application server, analytics, or telemetry. It makes requests directly from the extension to the AI service configured by the user.

## Sent to the AI service

Generating suggestions sends:

- The selected model name and grouping preferences.
- Each selected tab's ID, title (up to 300 characters), hostname, and current group ID.
- The IDs and names of existing groups in the current window, used to match merge targets.
- Instructions describing the expected grouping response and the selected language for group names.

Bookmark suggestions instead send selected bookmark IDs, titles (up to 300 characters), and hostnames, plus IDs and names of writable direct child folders within the selected folder. Folder paths, complete bookmark URLs, unselected bookmark titles, and subfolder contents are not sent. The model and grouping preferences are shared with tab grouping.

An API key, if configured, is sent in the `Authorization` header. The connection test sends a short prompt and does not include tabs. The service may retain request data according to its own policies; AI Tab cannot control that retention.

Full tab URLs, query parameters, page content, cookies, browsing history, and unselected tab titles are not included in the request. Selected tab titles, existing group names, and user-written preferences can contain sensitive information.

Requests use HTTPS, except for supported local loopback addresses. They do not include browser cookies and do not follow redirects. Error messages do not display provider response bodies.

## Stored in the browser

| Storage                  | Data                                                                                                  | Purpose                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `chrome.storage.local`   | API URL, API key, model, grouping preferences                                                         | Service configuration                    |
| `chrome.storage.local`   | Language preference                                                                                   | Panel language and suggested group names |
| `chrome.storage.session` | Original tab URLs and group metadata, last operation                                                  | Detect changed tabs and restore grouping |
| `chrome.storage.session` | Original bookmark URLs, titles, parent folders and positions; destination and created folder metadata | Recover the latest bookmark organization |

Local storage is restricted to trusted extension contexts and does not use Chrome Sync. It is not an operating-system keychain. Undo data is session-scoped and is cleared when the browser session ends; it is not a permanent history.

To replace stored credentials, save new settings. Uninstalling the extension removes its extension storage.

## Requested permissions

| Permission               | Use                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `tabs`                   | Read tab titles, URLs, IDs, and grouping state; move selected tabs into groups                                            |
| `tabGroups`              | Read and update native group names, colors, and collapsed state                                                           |
| `storage`                | Save service configuration, language preference, and session undo records                                                 |
| `sidePanel`              | Display the extension panel                                                                                               |
| Optional API host access | Send requests to the configured service                                                                                   |
| Optional `bookmarks`     | Read the bookmark tree for folder selection; create folders and move selected bookmarks after preview; undo these changes |

Host permission is requested when saving AI service settings. Changing the language does not request host access or contact the AI service. Chrome grants access by scheme and hostname, not port. Changing the API URL does not automatically revoke earlier host grants; these can be reviewed or removed in Chrome's extension settings.

Bookmark access is requested only through **Allow bookmark access**, using Chrome's [optional permission API](https://developer.chrome.com/docs/extensions/reference/api/permissions). The extension does not access the bookmark tree without this permission. Granting it reads bookmarks locally; only clicking **Suggest folders** sends selected metadata to the AI service.

AI Tab does not inject content scripts into websites. Private browsing is disabled in the manifest, and private tabs are excluded from grouping.

## Grouping and undo

Only selected eligible tabs in the current window are modified. Suggestions can create a new group with at least two tabs or add one or more tabs to an existing group. Existing target names, colors, and members are preserved. Grouping is user-triggered and requires applying a preview. No background grouping requests are made.

Before applying, AI Tab checks that the tabs still match the preview and target groups still exist with the same name and color in this window. Undoing a merge restores only the tabs added by that operation. Undo avoids overwriting groups subsequently renamed or recolored and skips tabs that have since moved or navigated. It restores group membership where possible, but not original tab order. If recovery is interrupted, some changes may remain until undo is retried.

## Bookmarks and undo

Only selected direct HTTP/HTTPS bookmarks in one writable folder are moved, up to 200 per request. Targets are existing direct child folders or new folders created there. Managed folders and bookmarklets are excluded. Existing bookmark titles, URLs, folders, and unselected items are not deleted or rewritten. The [Chrome bookmarks API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) performs the native changes, which can sync through Chrome's bookmark sync independently of extension storage.

Before applying, the extension validates the selected bookmark identities, titles, URLs and parent folders, and checks that the source and target folders still match the preview. Each move is recorded in session storage before it is issued. Partial failures trigger rollback; incomplete recovery keeps the record for retry. Closing the panel during a mutation may leave partial changes recoverable through **Undo last bookmark organization**. Closing it immediately after a folder is created but before its ID is saved can leave an empty folder.

There is one bookmark undo record per browser session, shared across windows and separate from tab undo. Applying another bookmark plan replaces it. Apply and undo operations are serialized across extension panels. Undo restores original parents and sibling positions where possible, skips bookmarks or targets edited or moved afterward, and removes only unchanged empty folders created by that operation. If the original folder moved, was renamed or was removed, recovery stops and keeps the record. Browser APIs are not transactional: changes made concurrently in Chrome or by sync can still interrupt application or recovery. Restarting the browser clears the session undo record.
