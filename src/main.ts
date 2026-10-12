import { AiTabAppElement } from './components/app';
import { BookmarkOrganizerElement } from './components/bookmarks';
import { SettingsFormElement } from './components/settings-form';
import { GroupCardElement } from './components/group-card';
import { LinkRowElement } from './components/link-row';

customElements.define('ai-link-row', LinkRowElement);
customElements.define('ai-group-card', GroupCardElement);
customElements.define('ai-tab-settings', SettingsFormElement);
customElements.define('ai-bookmark-organizer', BookmarkOrganizerElement);
customElements.define('ai-tab-app', AiTabAppElement);
