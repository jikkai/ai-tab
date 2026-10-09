import { AiTabAppElement } from './components/app';
import { SettingsFormElement } from './components/settings-form';
import { TabGroupElement } from './components/tab-group';
import { TabRowElement } from './components/tab-row';

customElements.define('ai-tab-row', TabRowElement);
customElements.define('ai-tab-group', TabGroupElement);
customElements.define('ai-tab-settings', SettingsFormElement);
customElements.define('ai-tab-app', AiTabAppElement);
