# Data and permissions

AI Tab has no application server, analytics, or telemetry. It makes requests directly from the extension to the AI service configured by the user.

## Sent to the AI service

Generating suggestions sends:

- The selected model name and grouping preferences.
- Each selected tab's ID, title (up to 300 characters), hostname, and current group ID.
- The IDs and names of existing groups in the current window, used to match merge targets.
- Instructions describing the expected grouping response and the selected language for group names.

An API key, if configured, is sent in the `Authorization` header. The connection test sends a short prompt and does not include tabs. The service may retain request data according to its own policies; AI Tab cannot control that retention.

Full tab URLs, query parameters, page content, cookies, browsing history, and unselected tab titles are not included in the request. Selected tab titles, existing group names, and user-written preferences can contain sensitive information.

Requests use HTTPS, except for supported local loopback addresses. They do not include browser cookies and do not follow redirects. Error messages do not display provider response bodies.

## Stored in the browser

| Storage                  | Data                                                 | Purpose                                  |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------- |
| `chrome.storage.local`   | API URL, API key, model, grouping preferences        | Service configuration                    |
| `chrome.storage.local`   | Language preference                                  | Panel language and suggested group names |
| `chrome.storage.session` | Original tab URLs and group metadata, last operation | Detect changed tabs and restore grouping |

Local storage is restricted to trusted extension contexts and does not use Chrome Sync. It is not an operating-system keychain. Undo data is session-scoped and is cleared when the browser session ends; it is not a permanent history.

To replace stored credentials, save new settings. Uninstalling the extension removes its extension storage.

## Requested permissions

| Permission               | Use                                                                            |
| ------------------------ | ------------------------------------------------------------------------------ |
| `tabs`                   | Read tab titles, URLs, IDs, and grouping state; move selected tabs into groups |
| `tabGroups`              | Read and update native group names, colors, and collapsed state                |
| `storage`                | Save service configuration, language preference, and session undo records      |
| `sidePanel`              | Display the extension panel                                                    |
| Optional API host access | Send requests to the configured service                                        |

Host permission is requested when saving AI service settings. Changing the language does not request host access or contact the AI service. Chrome grants access by scheme and hostname, not port. Changing the API URL does not automatically revoke earlier host grants; these can be reviewed or removed in Chrome's extension settings.

AI Tab does not inject content scripts into websites. Private browsing is disabled in the manifest, and private tabs are excluded from grouping.

## Grouping and undo

Only selected eligible tabs in the current window are modified. Suggestions can create a new group with at least two tabs or add one or more tabs to an existing group. Existing target names, colors, and members are preserved. Grouping is user-triggered and requires applying a preview. No background grouping requests are made.

Before applying, AI Tab checks that the tabs still match the preview and target groups still exist with the same name and color in this window. Undoing a merge restores only the tabs added by that operation. Undo avoids overwriting groups subsequently renamed or recolored and skips tabs that have since moved or navigated. It restores group membership where possible, but not original tab order. If recovery is interrupted, some changes may remain until undo is retried.
